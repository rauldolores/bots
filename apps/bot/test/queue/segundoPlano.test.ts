// El trabajo de segundo plano de un turno (hoy: el revisor rápido en modo
// sombra, ver agent/revisorRapido.ts) se espera DESPUÉS de enviar la
// respuesta, con tope. Es lo que hace que la sombra no le cueste ni un
// milisegundo al cliente y que en Vercel la función siga viva para anotarlo.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb } from "../helpers/pgSetup";

vi.mock("ai", () => ({ streamText: vi.fn(), tool: (def: any) => def }));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: () => (modelId: string) => ({ modelId }) }));

import { ingestMessage } from "../../src/agent/runner";
import { tick } from "../../src/queue/tick";
import { SettingsRepo } from "../../src/db/settings";
import * as senderMod from "../../src/replies/sender";
import * as turnMod from "../../src/agent/turn";
import type { Db } from "../../src/db/client";

let db: Db;
let env: any;
const eventos: string[] = [];

function resultadoConSegundoPlano(trabajo: Promise<unknown>): turnMod.AgentTurnResult {
  return {
    text: "respuesta",
    modelId: "claude-haiku-4-5-20251001",
    inputTokens: 1,
    outputTokens: 1,
    cachedTokens: 0,
    toolCallsMade: [],
    adjuntos: [],
    cfg: { maxChunks: 1, interChunkDelayMs: 0 } as any,
    segundoPlano: [trabajo],
  };
}

async function unTurno() {
  await ingestMessage(env, { channel: "telegram", channelUserId: "u-sp", text: "hola" });
  await db.run("UPDATE agent_jobs SET run_after = (EXTRACT(EPOCH FROM now()) * 1000)::bigint - 1000");
  return tick(env);
}

beforeEach(async () => {
  db = await createTestDb();
  vi.restoreAllMocks();
  vi.spyOn(SettingsRepo.prototype, "all").mockResolvedValue({});
  eventos.length = 0;
  vi.spyOn(senderMod, "pickAdapter").mockReturnValue({
    sendReply: vi.fn(async () => void eventos.push("enviado")),
  } as any);
  env = { DB: db.driver, ANTHROPIC_API_KEY: "sk-test", BOT_TIER: "free", BOT_LANGUAGE: "es", BUFFER_SECONDS: "8", BOT_NAME: "T", BUSINESS_NAME: "T" };
});

afterEach(() => vi.restoreAllMocks());

describe("trabajo de segundo plano del turno", () => {
  it("se termina DESPUÉS de enviar, y el turno lo espera", async () => {
    // La revisión termina 200 ms DESPUÉS de que se envió la respuesta. Si el
    // runner no la esperara, el tick volvería sin "revisado".
    vi.spyOn(turnMod, "runAgentTurnCore").mockImplementation(async () =>
      resultadoConSegundoPlano(
        (async () => {
          while (!eventos.includes("enviado")) await new Promise((r) => setTimeout(r, 10));
          await new Promise((r) => setTimeout(r, 200));
          eventos.push("revisado");
        })(),
      ),
    );
    const r = await unTurno();
    expect(r.answered).toBe(1);
    expect(eventos).toEqual(["enviado", "revisado"]);
  });

  it("si nunca termina, el turno no se queda colgado: se rinde al tope", async () => {
    let devolvio = 0;
    vi.spyOn(turnMod, "runAgentTurnCore").mockImplementation(async () => {
      devolvio = Date.now();
      return resultadoConSegundoPlano(new Promise(() => {}));
    });
    const r = await unTurno();
    expect(r.answered).toBe(1);
    expect(eventos).toEqual(["enviado"]);
    // Se mide desde que el turno devolvió, no desde el inicio: la base local
    // puede tardar en llegar hasta ahí, y eso no es lo que se prueba.
    expect(Date.now() - devolvio).toBeLessThan(6_000);
  }, 60_000);

  it("si falla, el turno se da por contestado igual", async () => {
    // Falla MIENTRAS se envía la respuesta: el runner tiene que haberla atado ya.
    vi.spyOn(turnMod, "runAgentTurnCore").mockImplementation(async () =>
      resultadoConSegundoPlano(new Promise((_, rechazar) => setTimeout(() => rechazar(new Error("jev caído")), 5))),
    );
    const r = await unTurno();
    expect(r).toMatchObject({ answered: 1, failed: 0 });
  });
});
