/**
 * Qué pasa cuando el plan se queda sin cupo.
 *
 * Antes, al agotarse las conversaciones, el mensaje se descartaba en silencio
 * (runner.ts: "mensaje sin atender"). El cliente del negocio escribía por
 * WhatsApp y nadie le contestaba, sin explicación, sin registro, y el dueño
 * se enteraba —si acaso— por un warn en el log.
 *
 * `hayCupo`/`contarUso` van mockeados: lo que se prueba es la orquestación
 * (contestar una vez, pausar, contar, avisar, admitir), no el protocolo con
 * KontrolIA, que ya prueba billing/kontrolia.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { SettingsRepo } from "../../src/db/settings";
import type { Env } from "../../src/env";

const sendReply = vi.fn();
vi.mock("../../src/replies/sender", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/replies/sender")>();
  return { ...actual, pickAdapter: () => ({ sendReply, parseIncoming: vi.fn() }) };
});

const hayCupoMock = vi.fn();
const contarUsoMock = vi.fn();
vi.mock("../../src/billing/kontrolia", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/billing/kontrolia")>();
  return {
    ...actual,
    hayCupo: (...a: unknown[]) => hayCupoMock(...a),
    contarUso: (...a: unknown[]) => contarUsoMock(...a),
  };
});

const notifyOwnerMock = vi.fn();
vi.mock("../../src/tools/handoffHuman", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/tools/handoffHuman")>();
  return { ...actual, notifyOwner: (...a: unknown[]) => notifyOwnerMock(...a) };
});

const { ingestMessage } = await import("../../src/agent/runner");
const { registrarSinCupo, MENSAJE_SIN_CUPO_CHAT } = await import("../../src/billing/sinCupo");
const { LIMITES } = await import("../../src/billing/kontrolia");
const { VENTANA_DE_CONVERSACION_MS } = await import("../../src/billing/conversacion");

import type { UsageReport } from "@kontrolia/auth/server";

const uso = (used: number, limit: number, key = "conversaciones"): UsageReport => ({
  key,
  used,
  limit,
  remaining: Math.max(0, limit - used),
  period: "month",
  periodStart: "2026-09-01",
  exceeded: used >= limit,
  planSlug: "plan-impulso",
  overagePriceAmount: null,
  overageUnits: 0,
  overageAmount: 0,
  currency: "MXN",
});
const AGOTADO = { ok: false as const, usage: uso(1000, 1000) };
const CON_CUPO = { ok: true as const, usage: uso(10, 1000) };

let db: Db;
let env: Env;

beforeEach(async () => {
  db = await createTestDb();
  sendReply.mockReset();
  hayCupoMock.mockReset().mockResolvedValue(CON_CUPO);
  contarUsoMock.mockReset().mockResolvedValue(null);
  notifyOwnerMock.mockReset().mockResolvedValue(undefined);
  env = {
    DB: db.driver,
    BOT_NAME: "Testi",
    BUSINESS_NAME: "Negocio de Prueba",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "15",
    ANTHROPIC_API_KEY: "sk-test",
  } as unknown as Env;
});

const entra = (text: string, channelUserId = "+5215512345678") =>
  ingestMessage(env, { channel: "twilio", channelUserId, text }, TEST_BOT_ID);

/** Simula que la sesión vigente lleva `ms` sin mensajes. */
async function envejecer(convId: string, ms: number) {
  const hace = Date.now() - ms;
  await db.run("UPDATE conversations SET last_message_at = ?, sesion_iniciada_at = ? WHERE id = ?", [hace, hace, convId]);
}

describe("una conversación es una sesión de 24 h (billing/conversacion.ts)", () => {
  it("la primera vez que alguien escribe se cuenta una conversación", async () => {
    await entra("Hola");
    expect(contarUsoMock).toHaveBeenCalledTimes(1);
    const conv = (await new ConversationsRepo(db, TEST_BOT_ID).findByChannelUserId("twilio", "+5215512345678"))!;
    expect(conv.sesion_iniciada_at).toBeGreaterThan(0);
  });

  it("varios mensajes seguidos (dentro del buffer) son UNA conversación", async () => {
    await entra("Hola");
    await entra("quiero información");
    await entra("de los precios");
    expect(contarUsoMock).toHaveBeenCalledTimes(1);
  });

  it("la misma persona al día siguiente (más de 24 h en silencio) es OTRA conversación", async () => {
    await entra("Hola");
    const conv = (await new ConversationsRepo(db, TEST_BOT_ID).findByChannelUserId("twilio", "+5215512345678"))!;
    await envejecer(conv.id, VENTANA_DE_CONVERSACION_MS + 60_000);

    await entra("Hola otra vez");

    expect(contarUsoMock).toHaveBeenCalledTimes(2);
    // Con clave de idempotencia distinta: es otra sesión, no un reintento.
    const claves = contarUsoMock.mock.calls.map((c) => c[3] as string);
    expect(new Set(claves).size).toBe(2);
    expect(claves.every((k) => k.startsWith(`${conv.id}:`))).toBe(true);
  });

  it("si vuelve dentro de las 24 h, sigue siendo la misma conversación", async () => {
    await entra("Hola");
    const conv = (await new ConversationsRepo(db, TEST_BOT_ID).findByChannelUserId("twilio", "+5215512345678"))!;
    await envejecer(conv.id, VENTANA_DE_CONVERSACION_MS - 60_000);

    await entra("¿Sigues ahí?");

    expect(contarUsoMock).toHaveBeenCalledTimes(1);
  });

  it("una plática que se alarga más de 24 h en total NO se parte mientras no haya silencio", async () => {
    await entra("Hola");
    const convs = new ConversationsRepo(db, TEST_BOT_ID);
    const conv = (await convs.findByChannelUserId("twilio", "+5215512345678"))!;
    // La sesión abrió hace 30 h, pero el último mensaje fue hace 2 h.
    await db.run("UPDATE conversations SET sesion_iniciada_at = ?, last_message_at = ? WHERE id = ?", [
      Date.now() - 30 * 3600_000,
      Date.now() - 2 * 3600_000,
      conv.id,
    ]);

    await entra("¿Entonces qué precio me das?");

    expect(contarUsoMock).toHaveBeenCalledTimes(1);
  });

  it("filas de antes de esta regla (sin sesión) cuentan al siguiente mensaje", async () => {
    await entra("Hola");
    const conv = (await new ConversationsRepo(db, TEST_BOT_ID).findByChannelUserId("twilio", "+5215512345678"))!;
    await db.run("UPDATE conversations SET sesion_iniciada_at = NULL WHERE id = ?", [conv.id]);
    contarUsoMock.mockClear();

    await entra("Hola");
    expect(contarUsoMock).toHaveBeenCalledTimes(1);
  });

  it("dos webhooks del mismo cliente al mismo tiempo abren UNA sola sesión", async () => {
    const convs = new ConversationsRepo(db, TEST_BOT_ID);
    const conv = await convs.getOrCreate("twilio", "+5215599999999");
    const resultados = await Promise.all(
      Array.from({ length: 5 }, () => convs.abrirSesionSiVencio(conv.id, VENTANA_DE_CONVERSACION_MS)),
    );
    expect(resultados.filter((r) => r !== null)).toHaveLength(1);
  });

  it("quien llegó sin cupo NO abre otra sesión al insistir; al admitirse, su sesión arranca ahí", async () => {
    hayCupoMock.mockResolvedValue(AGOTADO);
    await entra("Hola");
    const convs = new ConversationsRepo(db, TEST_BOT_ID);
    let conv = (await convs.findByChannelUserId("twilio", "+5215512345678"))!;
    // Pasan dos días: se le venció la pausa y también la "sesión".
    await convs.setPausedUntil(conv.id, null);
    await envejecer(conv.id, 2 * VENTANA_DE_CONVERSACION_MS);

    await entra("¿Hola?");
    expect(contarUsoMock).toHaveBeenCalledTimes(1); // solo la de cuando llegó

    await convs.setPausedUntil(conv.id, null);
    hayCupoMock.mockResolvedValue(CON_CUPO);
    const antes = Date.now();
    await entra("¿Ya?");
    conv = (await convs.findByChannelUserId("twilio", "+5215512345678"))!;
    expect(conv.sin_cupo_at).toBeNull();
    expect(conv.sesion_iniciada_at).toBeGreaterThanOrEqual(antes);
    expect(contarUsoMock).toHaveBeenCalledTimes(1); // y no se cuenta otra vez
  });
});

describe("sin cupo de conversaciones — al cliente final", () => {
  it("se le contesta UNA vez con un mensaje que no menciona el plan, y se pausa", async () => {
    hayCupoMock.mockResolvedValue(AGOTADO);

    const r = await entra("Hola, quiero información");

    expect(r.scheduledInMs).toBeNull(); // no gasta LLM
    expect(sendReply).toHaveBeenCalledTimes(1);
    const texto = sendReply.mock.calls[0][0].chunks[0] as string;
    expect(texto).toBe(MENSAJE_SIN_CUPO_CHAT);
    expect(texto.toLowerCase()).not.toMatch(/plan|límite|limite|cupo/);

    const conv = (await new ConversationsRepo(db, TEST_BOT_ID).findByChannelUserId("twilio", "+5215512345678"))!;
    expect(conv.sin_cupo_at).toBeGreaterThan(0);
    expect(conv.paused_until).toBeGreaterThan(Date.now());
    // Y la respuesta queda en el historial, para que el dueño vea qué se le dijo.
    const msgs = await new MessagesRepo(db, TEST_BOT_ID).lastN(conv.id, 5);
    expect(msgs.some((m) => m.role === "assistant" && m.content === MENSAJE_SIN_CUPO_CHAT)).toBe(true);
  });

  it("si vuelve a escribir en el mismo día, NO se le repite", async () => {
    hayCupoMock.mockResolvedValue(AGOTADO);
    await entra("Hola");
    await entra("¿Hay alguien?");
    await entra("Hola??");
    expect(sendReply).toHaveBeenCalledTimes(1);
  });

  it("la conversación se cuenta en el uso aunque no haya cupo — el panel debe decir la verdad", async () => {
    hayCupoMock.mockResolvedValue(AGOTADO);
    await entra("Hola");
    expect(contarUsoMock).toHaveBeenCalledWith(expect.anything(), expect.any(String), LIMITES.conversaciones, expect.any(String));
  });

  it("una conversación que YA se atendía sigue de largo aunque el cupo se agote", async () => {
    // Primero entra con cupo y queda como conversación normal.
    await entra("Hola");
    expect(sendReply).not.toHaveBeenCalled();
    // Ahora el cupo se agota — pero esta persona ya estaba en curso.
    hayCupoMock.mockResolvedValue(AGOTADO);
    const r = await entra("¿Y el precio?");
    expect(r.scheduledInMs).not.toBeNull(); // se atiende normal
    expect(sendReply).not.toHaveBeenCalled(); // sin mensaje de "no podemos"
  });

  it("cuando vuelve a haber cupo (el dueño subió de plan), se admite y se atiende", async () => {
    hayCupoMock.mockResolvedValue(AGOTADO);
    await entra("Hola");
    const convs = new ConversationsRepo(db, TEST_BOT_ID);
    let conv = (await convs.findByChannelUserId("twilio", "+5215512345678"))!;
    // Simular que pasó el día de pausa.
    await convs.setPausedUntil(conv.id, null);

    hayCupoMock.mockResolvedValue(CON_CUPO);
    const r = await entra("¿Siguen ahí?");

    expect(r.scheduledInMs).not.toBeNull();
    conv = (await convs.findByChannelUserId("twilio", "+5215512345678"))!;
    expect(conv.sin_cupo_at).toBeNull();
    // No se cuenta dos veces: ya se contó cuando llegó.
    expect(contarUsoMock).toHaveBeenCalledTimes(1);
  });

  it("si sigue sin cupo al día siguiente, se renueva la pausa en silencio", async () => {
    hayCupoMock.mockResolvedValue(AGOTADO);
    await entra("Hola");
    const convs = new ConversationsRepo(db, TEST_BOT_ID);
    const conv = (await convs.findByChannelUserId("twilio", "+5215512345678"))!;
    await convs.setPausedUntil(conv.id, null);

    const r = await entra("¿Hola?");

    expect(r.scheduledInMs).toBeNull();
    expect(sendReply).toHaveBeenCalledTimes(1); // solo la primera vez
    const despues = (await convs.findByChannelUserId("twilio", "+5215512345678"))!;
    expect(despues.paused_until).toBeGreaterThan(Date.now());
  });

  it("el sandbox del dueño (canal training) no pasa por el cupo", async () => {
    hayCupoMock.mockResolvedValue(AGOTADO);
    const r = await ingestMessage(env, { channel: "training", channelUserId: "dueno", text: "prueba" }, TEST_BOT_ID);
    expect(r.scheduledInMs).not.toBeNull();
    expect(hayCupoMock).not.toHaveBeenCalled();
  });
});

describe("sin cupo — al dueño", () => {
  it("se le avisa la primera vez, con cuántas personas se quedaron sin atender", async () => {
    const enviado = await registrarSinCupo(env, TEST_BOT_ID, LIMITES.conversaciones, AGOTADO.usage);
    expect(enviado).toBe(true);
    expect(notifyOwnerMock).toHaveBeenCalledTimes(1);
    const aviso = notifyOwnerMock.mock.calls[0][1] as { summary: string; ruta: string };
    expect(aviso.summary).toContain("1000 de 1000");
    expect(aviso.summary).toContain("1 persona");
    expect(aviso.ruta).toBe("/admin/plan");
  });

  it("no se repite en el mismo día; acumula y el siguiente aviso trae el total", async () => {
    await registrarSinCupo(env, TEST_BOT_ID, LIMITES.conversaciones, AGOTADO.usage);
    await registrarSinCupo(env, TEST_BOT_ID, LIMITES.conversaciones, AGOTADO.usage);
    await registrarSinCupo(env, TEST_BOT_ID, LIMITES.conversaciones, AGOTADO.usage);
    expect(notifyOwnerMock).toHaveBeenCalledTimes(1);

    // Simular que ya pasó un día.
    const settings = new SettingsRepo(db, TEST_BOT_ID);
    await settings.set("sin_cupo_avisado_at:conversaciones", String(Date.now() - 25 * 3600_000));

    await registrarSinCupo(env, TEST_BOT_ID, LIMITES.conversaciones, AGOTADO.usage);
    expect(notifyOwnerMock).toHaveBeenCalledTimes(2);
    const segundo = notifyOwnerMock.mock.calls[1][1] as { summary: string };
    // Las dos silenciosas + esta = 3 desde el último aviso.
    expect(segundo.summary).toContain("3 personas");
  });

  it("minutos de llamadas: el aviso habla de llamadas, no de mensajes", async () => {
    await registrarSinCupo(env, TEST_BOT_ID, LIMITES.llamadas, uso(200, 200, "llamadas"));
    const aviso = notifyOwnerMock.mock.calls[0][1] as { summary: string };
    expect(aviso.summary).toContain("minutos de llamadas");
    expect(aviso.summary).toContain("ha llamado");
  });

  it("si avisar falla, no lanza — es un extra, no la ruta crítica", async () => {
    notifyOwnerMock.mockRejectedValue(new Error("Telegram caído"));
    await expect(registrarSinCupo(env, TEST_BOT_ID, LIMITES.conversaciones, AGOTADO.usage)).resolves.toBe(false);
  });
});
