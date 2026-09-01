// "Interrumpir en vez de encolar" (versión segura) — lo que Hermes hace
// distinto: no dejar a alguien que sigue escribiendo esperando el buffer
// completo otra vez solo porque el turno anterior ya estaba pensando.
//
// La versión COMPLETA (descartar la respuesta en curso y regenerar con todo
// junto) no es segura hoy: runAgentTurnCore ya guarda el mensaje del cliente
// y la respuesta del bot en el historial ANTES de que runTurn decida si se
// manda — descartar después implicaría deshacer eso, y si a media
// generación ya se ejecutó una herramienta real (agendar, tocar el CRM), ya
// no hay nada que "descartar". Por eso esta versión NO toca la respuesta que
// ya se generó: solo se asegura de que el mensaje que llegó a medio turno
// consiga SU turno pronto — sin esperar otro buffer completo, y sin
// perderse (bug real: el complete() de siempre borraba la fila entera,
// llevándose consigo el reprogramado que ingestMessage() ya había puesto).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import type { Db } from "../../src/db/client";

const streamTextMock = vi.fn();
vi.mock("ai", () => ({
  streamText: (...args: any[]) => streamTextMock(...args),
  tool: (def: any) => def,
  jsonSchema: (s: any) => s,
}));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: () => (modelId: string) => ({ modelId }) }));

import { ingestMessage, conversationKeyOf } from "../../src/agent/runner";
import { tick } from "../../src/queue/tick";
import { SettingsRepo } from "../../src/db/settings";
import * as senderMod from "../../src/replies/sender";

const KEY = conversationKeyOf(TEST_BOT_ID, "telegram", "u1");

let db: Db;
let env: any;
let sendReply: ReturnType<typeof vi.fn>;

async function vencerTurnos() {
  await db.run("UPDATE agent_jobs SET run_after = (EXTRACT(EPOCH FROM now()) * 1000)::bigint - 1000");
}

/** Un stream que, a la mitad, le da chance a `enMedio` de correr — para simular al cliente escribiendo mientras el modelo sigue pensando. */
function streamConPausa(texto: string, enMedio?: () => Promise<void>) {
  async function* gen() {
    yield { type: "text-delta", text: texto.slice(0, Math.max(1, texto.length - 5)) };
    if (enMedio) await enMedio();
    yield { type: "text-delta", text: texto.slice(-5) };
  }
  return {
    fullStream: gen(),
    usage: Promise.resolve({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 }),
    steps: Promise.resolve([{ toolCalls: [] }]),
    finishReason: Promise.resolve("stop"),
    warnings: Promise.resolve([]),
    response: Promise.resolve({ id: "r1" }),
    request: Promise.resolve({ body: {} }),
  };
}

beforeEach(async () => {
  db = await createTestDb();
  vi.restoreAllMocks();
  vi.spyOn(SettingsRepo.prototype, "all").mockResolvedValue({});
  streamTextMock.mockReset();
  sendReply = vi.fn(async () => {});
  vi.spyOn(senderMod, "pickAdapter").mockReturnValue({ sendReply } as any);
  env = {
    DB: db.driver,
    ANTHROPIC_API_KEY: "sk-test",
    BOT_LANGUAGE: "es",
    BUFFER_SECONDS: "8",
    BOT_NAME: "TestBot",
    BUSINESS_NAME: "TestCo",
  };
});

describe("un mensaje que llega mientras el turno anterior corría", () => {
  it("no se pierde: consigue su propio turno pronto, sin esperar otro buffer completo de 8s", async () => {
    await ingestMessage(env, { channel: "telegram", channelUserId: "u1", text: "hola" });
    await vencerTurnos();

    streamTextMock.mockImplementation(() =>
      streamConPausa("respuesta al primero", async () => {
        // El cliente escribe de nuevo justo mientras el modelo sigue generando.
        await ingestMessage(env, { channel: "telegram", channelUserId: "u1", text: "otra cosa" });
      }),
    );

    const r = await tick(env);
    expect(r.answered).toBe(1);
    expect(sendReply).toHaveBeenCalledTimes(1); // solo salió la primera respuesta — esta versión no descarta ni fusiona

    // El trabajo NO se cerró (antes: complete() lo borraba y se llevaba el
    // reprogramado de ingestMessage con él) — se reprogramó para pronto, con
    // el lease suelto para que el próximo tick sí lo pueda tomar.
    const fila = await db.first<{ run_after: number; locked_at: number | null }>(
      "SELECT run_after, locked_at FROM agent_jobs WHERE conversation_key = ?",
      [KEY],
    );
    expect(fila).not.toBeNull();
    expect(fila!.locked_at).toBeNull();
    expect(fila!.run_after - Date.now()).toBeLessThan(4000); // mucho antes que los 8s del buffer normal

    // El mensaje nuevo sigue en el buffer, sin reclamar por nadie.
    const pend = await db.all<{ text: string; claimed_at: number | null }>(
      "SELECT text, claimed_at FROM pending_messages WHERE conversation_key = ?",
      [KEY],
    );
    expect(pend).toHaveLength(1);
    expect(pend[0].text).toBe("otra cosa");
    expect(pend[0].claimed_at).toBeNull();

    // Un tick posterior (ya vencido el reintento corto) sí lo responde.
    await vencerTurnos();
    streamTextMock.mockImplementation(() => streamConPausa("respuesta a lo nuevo"));
    const r2 = await tick(env);

    expect(r2.answered).toBe(1);
    expect(sendReply).toHaveBeenCalledTimes(2);
    expect(await db.all("SELECT id FROM pending_messages")).toHaveLength(0);
    expect(await db.all("SELECT conversation_key FROM agent_jobs")).toHaveLength(0);
  });

  it("sin nada nuevo, el trabajo se cierra normal — sin regresión sobre el comportamiento de siempre", async () => {
    await ingestMessage(env, { channel: "telegram", channelUserId: "u1", text: "hola" });
    await vencerTurnos();
    streamTextMock.mockImplementation(() => streamConPausa("respuesta"));

    const r = await tick(env);

    expect(r.answered).toBe(1);
    expect(await db.all("SELECT conversation_key FROM agent_jobs")).toHaveLength(0);
  });

  it("dos mensajes nuevos a medio turno: los dos esperan juntos el mismo reintento corto, no uno cada uno", async () => {
    await ingestMessage(env, { channel: "telegram", channelUserId: "u1", text: "hola" });
    await vencerTurnos();

    streamTextMock.mockImplementation(() =>
      streamConPausa("respuesta al primero", async () => {
        await ingestMessage(env, { channel: "telegram", channelUserId: "u1", text: "segundo" });
        await ingestMessage(env, { channel: "telegram", channelUserId: "u1", text: "tercero" });
      }),
    );

    await tick(env);
    expect(await db.all("SELECT conversation_key FROM agent_jobs")).toHaveLength(1); // no se duplicó el trabajo

    await vencerTurnos();
    streamTextMock.mockImplementation(() => streamConPausa("respuesta a los dos juntos"));
    await tick(env);

    expect(sendReply).toHaveBeenCalledTimes(2);
    const guardado = await db.first<{ content: string }>(
      "SELECT content FROM messages WHERE role = 'user' ORDER BY created_at DESC LIMIT 1",
    );
    expect(guardado!.content).toBe("segundo\ntercero"); // se juntaron en un solo turno, como cualquier buffer normal
  });
});
