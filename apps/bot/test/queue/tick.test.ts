// La garantía de producto que F3 no podía perder: si el cliente escribe tres
// mensajes seguidos, el bot responde UNA vez a los tres juntos — no tres veces.
//
// Con el Durable Object eso lo daba `setAlarm` sobre un actor único. Ahora sale
// del debounce de agent_jobs más el lease, así que hay que probarlo de verdad,
// de webhook a respuesta.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, createSecondTestBot, TEST_BOT_ID } from "../helpers/pgSetup";

const streamTextMock = vi.fn();

vi.mock("ai", () => ({
  streamText: (...args: any[]) => streamTextMock(...args),
  tool: (def: any) => def,
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => (modelId: string) => ({ modelId }),
}));

import { ingestMessage, conversationKeyOf } from "../../src/agent/runner";
import { tick } from "../../src/queue/tick";
import { SettingsRepo } from "../../src/db/settings";
import * as senderMod from "../../src/replies/sender";
import type { Db } from "../../src/db/client";

const KEY = conversationKeyOf(TEST_BOT_ID, "telegram", "u1");

function makeStreamResult(text: string) {
  async function* gen() {
    yield text;
  }
  return {
    textStream: gen(),
    usage: Promise.resolve({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 }),
    steps: Promise.resolve([{ toolCalls: [] }]),
  };
}

let db: Db;
let env: any;
let sendReply: ReturnType<typeof vi.fn>;

/** Adelanta el reloj de la cola: el turno queda vencido sin esperar 8s reales. */
async function vencerTurnos() {
  await db.run(
    "UPDATE agent_jobs SET run_after = (EXTRACT(EPOCH FROM now()) * 1000)::bigint - 1000",
  );
}

beforeEach(async () => {
  db = await createTestDb();
  vi.restoreAllMocks();
  vi.spyOn(SettingsRepo.prototype, "all").mockResolvedValue({});

  streamTextMock.mockReset();
  streamTextMock.mockImplementation(() => makeStreamResult("respuesta única"));

  sendReply = vi.fn(async () => {});
  vi.spyOn(senderMod, "pickAdapter").mockReturnValue({ sendReply } as any);

  env = {
    DB: db.driver,
    ANTHROPIC_API_KEY: "sk-test",
    BOT_TIER: "free",
    BOT_LANGUAGE: "es",
    BUFFER_SECONDS: "8",
    BOT_NAME: "TestBot",
    BUSINESS_NAME: "TestCo",
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tres mensajes seguidos = una sola respuesta", () => {
  it("junta el buffer en un turno y responde una vez", async () => {
    for (const text of ["hola", "estás ahí?", "quiero una cita"]) {
      await ingestMessage(env, { channel: "telegram", channelUserId: "u1", text });
    }

    // Un solo trabajo pendiente, con los tres mensajes esperando.
    expect(await db.all("SELECT conversation_key FROM agent_jobs")).toHaveLength(1);
    expect(await db.all("SELECT id FROM pending_messages")).toHaveLength(3);

    await vencerTurnos();
    const r = await tick(env);

    expect(r).toEqual({ claimed: 1, answered: 1, failed: 0, campaignsSent: 0 });
    expect(streamTextMock).toHaveBeenCalledTimes(1);
    expect(sendReply).toHaveBeenCalledTimes(1);

    // Y el LLM vio los tres mensajes como uno solo.
    const guardado = await db.first<{ content: string }>(
      "SELECT content FROM messages WHERE role = 'user' ORDER BY created_at DESC LIMIT 1",
    );
    expect(guardado!.content).toBe("hola\nestás ahí?\nquiero una cita");
  });

  it("el trabajo se cierra: un segundo tick no vuelve a responder", async () => {
    await ingestMessage(env, { channel: "telegram", channelUserId: "u1", text: "hola" });
    await vencerTurnos();

    await tick(env);
    const segundo = await tick(env);

    expect(segundo).toEqual({ claimed: 0, answered: 0, failed: 0, campaignsSent: 0 });
    expect(sendReply).toHaveBeenCalledTimes(1);
  });

  it("dos ticks simultáneos no responden dos veces a la misma conversación", async () => {
    await ingestMessage(env, { channel: "telegram", channelUserId: "u1", text: "hola" });
    await vencerTurnos();

    // Sin el SKIP LOCKED, ambos tomarían la misma fila y el cliente recibiría
    // la respuesta duplicada.
    const [a, b] = await Promise.all([tick(env), tick(env)]);

    expect(a.claimed + b.claimed).toBe(1);
    expect(sendReply).toHaveBeenCalledTimes(1);
  });

  it("atiende varias conversaciones en un mismo tick, sin mezclarlas", async () => {
    await ingestMessage(env, { channel: "telegram", channelUserId: "u1", text: "soy uno" });
    await ingestMessage(env, { channel: "telegram", channelUserId: "u2", text: "soy dos" });
    await vencerTurnos();

    const r = await tick(env);

    expect(r.claimed).toBe(2);
    expect(r.answered).toBe(2);
    expect(sendReply).toHaveBeenCalledTimes(2);
    const destinatarios = sendReply.mock.calls.map((c: any) => c[0].channelUserId).sort();
    expect(destinatarios).toEqual(["u1", "u2"]);
  });
});

describe("tick — sin trabajo y con fallos", () => {
  it("no hace nada cuando la cola está vacía", async () => {
    expect(await tick(env)).toEqual({ claimed: 0, answered: 0, failed: 0, campaignsSent: 0 });
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("no toma trabajos que todavía no vencen", async () => {
    await ingestMessage(env, { channel: "telegram", channelUserId: "u1", text: "hola" });
    // Sin vencerTurnos(): el buffer de 8s sigue corriendo.
    expect(await tick(env)).toEqual({ claimed: 0, answered: 0, failed: 0, campaignsSent: 0 });
    expect(sendReply).not.toHaveBeenCalled();
  });

  it("reenvía la respuesta ya redactada si el envío falló, sin volver a pensarla", async () => {
    await ingestMessage(env, { channel: "telegram", channelUserId: "u1", text: "hola" });
    await vencerTurnos();

    // Primer intento: el LLM responde bien, pero el canal está caído.
    sendReply.mockRejectedValueOnce(new Error("canal caído"));
    expect((await tick(env)).failed).toBe(1);

    // La respuesta quedó apartada, no perdida.
    const apartada = await db.first<{ pending_reply: string | null }>(
      "SELECT pending_reply FROM agent_jobs WHERE conversation_key = ?",
      [KEY],
    );
    expect(apartada!.pending_reply).toBe("respuesta única");

    // Segundo intento: se reenvía SIN volver a llamar al LLM.
    await vencerTurnos();
    const r = await tick(env);

    expect(r.answered).toBe(1);
    expect(sendReply).toHaveBeenCalledTimes(2);
    expect(streamTextMock).toHaveBeenCalledTimes(1); // ← no se pensó de nuevo
    expect(await db.all("SELECT conversation_key FROM agent_jobs")).toHaveLength(0);
  });

  it("un mensaje que llega DURANTE el fallo de envío no se queda huérfano", async () => {
    // El caso que apareció en el primer despliegue real: mientras el envío
    // estaba caído llegó otro mensaje. La vía de reenvío salía antes de vaciar
    // el buffer y el tick cerraba el trabajo, así que ese mensaje se quedaba sin
    // turno programado y sin respuesta para siempre.
    await ingestMessage(env, { channel: "telegram", channelUserId: "u1", text: "primero" });
    await vencerTurnos();

    sendReply.mockRejectedValueOnce(new Error("canal caído"));
    await tick(env);

    // Llega otro mensaje mientras el trabajo está fallido.
    await ingestMessage(env, { channel: "telegram", channelUserId: "u1", text: "segundo" });
    await vencerTurnos();
    await tick(env);

    // Nada queda pendiente, y el segundo mensaje SÍ se respondió.
    expect(await db.all("SELECT id FROM pending_messages")).toHaveLength(0);
    expect(await db.all("SELECT conversation_key FROM agent_jobs")).toHaveLength(0);
    const usuario = await db.all<{ content: string }>(
      "SELECT content FROM messages WHERE role = 'user' ORDER BY created_at",
    );
    expect(usuario.map((m) => m.content)).toEqual(["primero", "segundo"]);
  });

  it("el reenvío no duplica el historial", async () => {
    await ingestMessage(env, { channel: "telegram", channelUserId: "u1", text: "hola" });
    await vencerTurnos();

    sendReply.mockRejectedValueOnce(new Error("canal caído"));
    await tick(env);
    await vencerTurnos();
    await tick(env);

    // Un mensaje de usuario y uno de asistente: el reenvío no agrega filas.
    const msgs = await db.all<{ role: string }>("SELECT role FROM messages ORDER BY created_at");
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("un turno que revienta se reprograma en vez de perderse", async () => {
    await ingestMessage(env, { channel: "telegram", channelUserId: "u1", text: "hola" });
    await vencerTurnos();

    vi.spyOn(senderMod, "pickAdapter").mockImplementation(() => {
      throw new Error("canal caído");
    });

    const r = await tick(env);
    expect(r.failed).toBe(1);

    const fila = await db.first<{ last_error: string; locked_at: number | null }>(
      "SELECT last_error, locked_at FROM agent_jobs WHERE conversation_key = ?",
      [KEY],
    );
    expect(fila!.last_error).toContain("canal caído");
    expect(fila!.locked_at).toBeNull();
  });

  it("cierra el trabajo aunque el buffer estuviera vacío", async () => {
    // Puede pasar si el dueño despausó y otro tick ya se llevó los mensajes.
    await db.run(
      "INSERT INTO agent_jobs (conversation_key, run_after) VALUES (?, (EXTRACT(EPOCH FROM now()) * 1000)::bigint - 1000)",
      [KEY],
    );

    const r = await tick(env);

    expect(r).toEqual({ claimed: 1, answered: 0, failed: 0, campaignsSent: 0 });
    // Si no se cerrara, reintentaría para siempre sobre un buffer vacío.
    expect(await db.all("SELECT conversation_key FROM agent_jobs")).toHaveLength(0);
  });
});

describe("tick también procesa campañas encoladas (F6)", () => {
  it("un envío de campaña pendiente sale en el mismo tick, junto con los turnos del agente", async () => {
    const { enqueueCampaign } = await import("../../src/campaigns");
    const { ConversationsRepo } = await import("../../src/db/conversations");
    const { MessagesRepo } = await import("../../src/db/messages");
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("telegram", "u5");
    await new MessagesRepo(db, TEST_BOT_ID).append(conv.id, "user", "hola");

    await enqueueCampaign(env, {
      filters: {},
      campaignKey: "camp-en-tick",
      freeformText: "aviso de campaña",
      botId: TEST_BOT_ID,
    });

    const r = await tick(env);
    expect(r.campaignsSent).toBe(1);
    expect(sendReply).toHaveBeenCalledWith(
      expect.objectContaining({ channelUserId: "u5", chunks: ["aviso de campaña"] }),
      env,
    );
  });
});

describe("con 2+ bots en la tabla (F5): el webhook trae su propio botId, no debe adivinar", () => {
  // Bug real de producción: resolveAgentConfig() se llamaba sin el botId ya
  // resuelto por ingestMessage/runTurn, así que volvía a intentar
  // resolveBotId(db) por su cuenta — que revienta ("Hay 2 bots...") en
  // cuanto existe un segundo bot. Dormido mientras solo hubo un bot en toda
  // la sesión de F5, hasta que el dueño creó uno real.
  it("ingestMessage + tick responden bien con un segundo bot ya en la tabla", async () => {
    const otherBotId = await createSecondTestBot(db);
    const key = conversationKeyOf(otherBotId, "telegram", "u9");

    await ingestMessage(env, { channel: "telegram", channelUserId: "u9", text: "hola" }, otherBotId);
    await db.run(
      "UPDATE agent_jobs SET run_after = (EXTRACT(EPOCH FROM now()) * 1000)::bigint - 1000 WHERE conversation_key = ?",
      [key],
    );

    const r = await tick(env);
    expect(r).toEqual({ claimed: 1, answered: 1, failed: 0, campaignsSent: 0 });
    expect(sendReply).toHaveBeenCalledTimes(1);
  });
});
