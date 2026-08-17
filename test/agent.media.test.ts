// Media (voz e imagen) y el turno del LLM, ahora sobre la cola de Postgres en
// vez del Durable Object.
//
// Lo que antes se inspeccionaba en el estado del DO (`agent.state.pendingMessages`,
// `storage.setAlarm`) ahora se comprueba donde de verdad vive: las tablas
// pending_messages y agent_jobs. El LLM y la red siguen simulados.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb } from "./helpers/pgSetup";
import { ingestMessage, runTurn, conversationKeyOf } from "../src/agent/runner";
import { MessagesRepo } from "../src/db/messages";
import { SettingsRepo } from "../src/db/settings";
import * as senderMod from "../src/replies/sender";
import type { Db } from "../src/db/client";

const KEY = conversationKeyOf("telegram", "u1");

const streamTextMock = vi.fn();

vi.mock("ai", () => ({
  streamText: (...args: any[]) => streamTextMock(...args),
  tool: (def: any) => def,
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => (modelId: string) => ({ modelId }),
}));

/**
 * resolveAgentConfig lee la tabla `settings`. Se stubea para que la config caiga
 * en los defaults de env (bot no pausado, buffer de BUFFER_SECONDS, maxChunks=3,
 * modelOverride="auto"). Llamar DESPUÉS de vi.restoreAllMocks().
 */
function stubSettings(overrides: Record<string, string> = {}) {
  vi.spyOn(SettingsRepo.prototype, "all").mockResolvedValue(overrides);
}

function makeStreamResult(text: string) {
  async function* gen() {
    yield text;
  }
  return {
    textStream: gen(),
    usage: Promise.resolve({ inputTokens: 100, outputTokens: 50, cachedInputTokens: 0 }),
    steps: Promise.resolve([{ toolCalls: [] }]),
  };
}

let db: Db;

function makeEnv(opts?: { tier?: "free" | "pro"; aiText?: string }): any {
  return {
    DB: db.driver,
    AI: { run: vi.fn(async () => ({ text: opts?.aiText ?? "" })) },
    ANTHROPIC_API_KEY: "sk-test",
    BOT_TIER: opts?.tier ?? "free",
    BOT_LANGUAGE: "es",
    BUFFER_SECONDS: "8",
    BOT_NAME: "TestBot",
    BUSINESS_NAME: "TestCo",
  };
}

/** El buffer, que antes era `agent.state.pendingMessages`. */
function pendientes() {
  return db.all<{ text: string }>(
    "SELECT text FROM pending_messages WHERE conversation_key = ? ORDER BY id",
    [KEY],
  );
}

/** El turno programado, que antes era `storage.setAlarm`. */
function trabajos() {
  return db.all<{ conversation_key: string; run_after: number }>(
    "SELECT conversation_key, run_after FROM agent_jobs WHERE conversation_key = ?",
    [KEY],
  );
}

describe("ingestMessage — media", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    db = await createTestDb();
    vi.restoreAllMocks();
    stubSettings();
    originalFetch = globalThis.fetch;
    // La descarga del audio va simulada: transcribeAudio baja la URL y le pasa
    // los bytes a env.AI.run — ninguna de las dos toca la red real.
    globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("transcribes audio and buffers it as text", async () => {
    const env = makeEnv({ aiText: "hola desde un audio" });

    await ingestMessage(env, {
      channel: "telegram",
      channelUserId: "u1",
      audioUrl: "https://example.com/voice.ogg",
    });

    expect(env.AI.run).toHaveBeenCalled();
    const buffer = await pendientes();
    expect(buffer).toHaveLength(1);
    expect(buffer[0].text).toBe("hola desde un audio");
  });

  it("falls back to a friendly message when transcription throws", async () => {
    const env = makeEnv();
    (globalThis.fetch as any).mockRejectedValueOnce(new Error("network down"));

    await ingestMessage(env, {
      channel: "telegram",
      channelUserId: "u1",
      audioUrl: "https://example.com/voice.ogg",
    });

    expect((await pendientes())[0].text).toBe("(no pude entender el audio)");
  });

  it("free tier: strips the image and informs the bot it's unsupported", async () => {
    await ingestMessage(makeEnv({ tier: "free" }), {
      channel: "telegram",
      channelUserId: "u1",
      text: "mira esto",
      imageUrl: "https://example.com/pic.png",
    });

    const buffered = (await pendientes())[0].text;
    expect(buffered).toContain("mira esto");
    expect(buffered).toContain("no soporta análisis de imágenes");
    expect(buffered).not.toContain("IMAGE_URL");
  });

  it("pro tier: keeps the image as an [IMAGE_URL] marker in the buffer", async () => {
    await ingestMessage(makeEnv({ tier: "pro" }), {
      channel: "telegram",
      channelUserId: "u1",
      text: "describe esta foto",
      imageUrl: "https://example.com/pic.png",
    });

    const buffered = (await pendientes())[0].text;
    expect(buffered).toContain("describe esta foto");
    expect(buffered).toContain("[IMAGE_URL: https://example.com/pic.png]");

    const estado = await db.first<{ image_retry_count: number }>(
      "SELECT image_retry_count FROM agent_state WHERE conversation_key = ?",
      [KEY],
    );
    expect(estado!.image_retry_count).toBe(0);
  });
});

describe("runTurn — mensaje multimodal y prompt", () => {
  beforeEach(async () => {
    db = await createTestDb();
    vi.restoreAllMocks();
    stubSettings();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Deja el estado y el buffer listos, y corre un turno. */
  async function correrTurno(opts: { tier: "free" | "pro"; lastContent: string }) {
    const env = makeEnv({ tier: opts.tier });
    await ingestMessage(env, {
      channel: "telegram",
      channelUserId: "u1",
      text: opts.lastContent,
    });

    // Un resultado nuevo por llamada (el generador es de un solo uso).
    streamTextMock.mockReset();
    streamTextMock.mockImplementation(() => makeStreamResult("ok"));

    vi.spyOn(MessagesRepo.prototype, "lastN").mockResolvedValue([
      { role: "user", content: "mensaje previo" },
      { role: "assistant", content: "respuesta previa" },
      { role: "user", content: opts.lastContent },
    ] as any);
    vi.spyOn(senderMod, "pickAdapter").mockReturnValue({
      sendReply: vi.fn(async () => {}),
    } as any);

    await runTurn(env, KEY);
    return streamTextMock.mock.calls[0][0];
  }

  it("pro tier: builds a multimodal message from the [IMAGE_URL] marker", async () => {
    const arg = await correrTurno({
      tier: "pro",
      lastContent: "describe esto\n[IMAGE_URL: https://example.com/pic.png]",
    });

    const last = arg.messages[arg.messages.length - 1];
    expect(Array.isArray(last.content)).toBe(true);
    expect(last.content).toEqual([
      { type: "image", image: new URL("https://example.com/pic.png") },
      { type: "text", text: "describe esto" },
    ]);
  });

  it("free tier: leaves the last message as plain text (no multimodal build)", async () => {
    const arg = await correrTurno({ tier: "free", lastContent: "hola normal" });

    const last = arg.messages[arg.messages.length - 1];
    expect(last).toEqual({ role: "user", content: "hola normal" });
  });

  it("caches the system prompt as a SystemModelMessage with an ephemeral breakpoint", async () => {
    const arg = await correrTurno({ tier: "free", lastContent: "hola" });

    expect(Array.isArray(arg.system)).toBe(true);
    expect(arg.system).toHaveLength(1);
    expect(arg.system[0].role).toBe("system");
    expect(typeof arg.system[0].content).toBe("string");
    expect(arg.system[0].providerOptions).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
  });

  it("honors model_override=sonnet from settings", async () => {
    stubSettings({ model_override: "sonnet" });
    const arg = await correrTurno({ tier: "free", lastContent: "hola" });

    expect(arg.model).toEqual({ modelId: "claude-sonnet-4-5-20250929" });
  });

  it("vacía el buffer: un segundo turno seguido no vuelve a responder", async () => {
    const env = makeEnv({ tier: "free" });
    await ingestMessage(env, { channel: "telegram", channelUserId: "u1", text: "hola" });

    streamTextMock.mockReset();
    streamTextMock.mockImplementation(() => makeStreamResult("ok"));
    vi.spyOn(MessagesRepo.prototype, "lastN").mockResolvedValue([
      { role: "user", content: "hola" },
    ] as any);
    vi.spyOn(senderMod, "pickAdapter").mockReturnValue({
      sendReply: vi.fn(async () => {}),
    } as any);

    expect(await runTurn(env, KEY)).toBe(true);
    expect(await runTurn(env, KEY)).toBe(false);
    expect(streamTextMock).toHaveBeenCalledTimes(1);
  });
});

describe("ingestMessage — bot_paused (settings)", () => {
  beforeEach(async () => {
    db = await createTestDb();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("buffers the client message but does NOT schedule a turn when bot_paused=1", async () => {
    stubSettings({ bot_paused: "1" });

    const r = await ingestMessage(makeEnv({ tier: "free" }), {
      channel: "telegram",
      channelUserId: "u1",
      text: "hola, estoy pausado?",
    });

    // El mensaje se guarda …
    const buffer = await pendientes();
    expect(buffer).toHaveLength(1);
    expect(buffer[0].text).toBe("hola, estoy pausado?");
    // … pero el bot se queda callado: no hay turno programado.
    expect(await trabajos()).toHaveLength(0);
    expect(r.scheduledInMs).toBeNull();
  });

  it("schedules a turn when the bot is not paused", async () => {
    stubSettings();

    const r = await ingestMessage(makeEnv({ tier: "free" }), {
      channel: "telegram",
      channelUserId: "u1",
      text: "hola",
    });

    expect(await trabajos()).toHaveLength(1);
    expect(r.scheduledInMs).toBe(8000);
  });
});
