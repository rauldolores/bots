/**
 * El cliente de JEV AI (src/ai/jev.ts). La red se simula; la base es real,
 * porque lo que importa es qué queda anotado (costos y clasificaciones).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { noul, choice } from "@typesafe-ai/sdk";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import type { Db } from "../../src/db/client";
import type { Env } from "../../src/env";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { clasificar, anotarClasificacion, modoJev, MODELO_JEV } from "../../src/ai/jev";
import { costOfUsage } from "../../src/pricing";

let db: Db;
const env = { TYPESAFE_API_KEY: "ts-prueba" } as unknown as Env;
const PREGUNTAS = {
  promete: noul("¿El párrafo promete algo a futuro?"),
  tono: choice("¿Qué tono tiene?", { amable: null, seco: null }),
};

function respuestaDeApi(cuerpo: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } }));
}
const BUENA = {
  model: MODELO_JEV,
  answers: {
    promete: { type: "noul", noul: 0.93 },
    tono: { type: "choice", choice: "amable", confidence: 0.88, probabilities: { amable: 0.9, seco: 0.1 } },
  },
  usage: { input_tokens: 600, output_tokens: 40 },
};

beforeEach(async () => {
  db = await createTestDb();
});

describe("clasificar", () => {
  it("devuelve las respuestas y anota el costo como 'clasificador' en la conversación", async () => {
    const fetch = respuestaDeApi(BUENA);
    const r = await clasificar(env, db, { parrafo: "Te mando la propuesta mañana." }, PREGUNTAS, {
      botId: TEST_BOT_ID,
      uso: "promesas",
      refId: "conv-1",
      fetch,
    });
    expect(r?.respuestas.promete.noul).toBe(0.93);
    expect(r?.respuestas.tono.choice).toBe("amable");
    expect(r?.modelo).toBe(MODELO_JEV);

    // Lo que se manda: la versión fija, no el alias que se mueve solo.
    const cuerpo = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(cuerpo.model).toBe(MODELO_JEV);

    const uso = await db.all<{ source: string; ref_id: string; model_used: string; input_tokens: number }>(
      "SELECT source, ref_id, model_used, input_tokens FROM ai_usage",
    );
    expect(uso).toEqual([{ source: "clasificador", ref_id: "conv-1", model_used: MODELO_JEV, input_tokens: 600 }]);
  });

  it("sin llave en el despliegue no llama a nadie", async () => {
    const fetch = respuestaDeApi(BUENA);
    const r = await clasificar({} as Env, db, "hola", PREGUNTAS, { botId: TEST_BOT_ID, uso: "x", fetch });
    expect(r).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  // La regla que no se negocia: una falla del clasificador nunca tumba el turno.
  it("si el servicio falla, devuelve null sin lanzar y sin reintentar", async () => {
    const fetch = respuestaDeApi({ error: "caído" }, 503);
    const r = await clasificar(env, db, "hola", PREGUNTAS, { botId: TEST_BOT_ID, uso: "x", fetch });
    expect(r).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await db.all("SELECT * FROM ai_usage")).toHaveLength(0);
  });

  it("si tarda de más, se rinde a tiempo y devuelve null", async () => {
    const lento = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, rechazar) => {
          init?.signal?.addEventListener("abort", () => rechazar(new DOMException("abortado", "AbortError")));
        }),
    );
    const inicio = Date.now();
    const r = await clasificar(env, db, "hola", PREGUNTAS, { botId: TEST_BOT_ID, uso: "x", fetch: lento as unknown as typeof fetch, timeoutMs: 50 });
    expect(r).toBeNull();
    expect(Date.now() - inicio).toBeLessThan(2_000);
  });
});

describe("modoJev", () => {
  it("por defecto está apagado", async () => {
    expect(await modoJev(env, db, TEST_BOT_ID)).toBe("apagado");
  });

  it("respeta el ajuste del bot", async () => {
    await new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.jevModo, "sombra");
    expect(await modoJev(env, db, TEST_BOT_ID)).toBe("sombra");
  });

  it("sin llave en el despliegue queda apagado aunque el ajuste diga activo", async () => {
    await new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.jevModo, "activo");
    expect(await modoJev({} as Env, db, TEST_BOT_ID)).toBe("apagado");
  });

  it("un valor desconocido cuenta como apagado", async () => {
    await new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.jevModo, "encendidisimo");
    expect(await modoJev(env, db, TEST_BOT_ID)).toBe("apagado");
  });
});

describe("anotarClasificacion", () => {
  it("guarda lo que dijo Jev junto a lo que dijo la regla de hoy", async () => {
    await anotarClasificacion(db, TEST_BOT_ID, {
      uso: "promesas",
      refId: "conv-1",
      modo: "sombra",
      clasificacion: { respuestas: BUENA.answers as never, modelo: MODELO_JEV, ms: 142.6 },
      regla: { promete: false },
    });
    const [fila] = await db.all<{ uso: string; modo: string; ms: number; jev_promete: string; regla_promete: string }>(
      `SELECT uso, modo, ms,
              (jev #>> '{}')::jsonb->'promete'->>'noul' AS jev_promete,
              (regla #>> '{}')::jsonb->>'promete' AS regla_promete
         FROM clasificaciones`,
    );
    expect(fila).toEqual({ uso: "promesas", modo: "sombra", ms: 143, jev_promete: "0.93", regla_promete: "false" });
  });
});

describe("costo", () => {
  // Sin su tarifa propia caería en la de Haiku y Costos lo mostraría ~20x más caro.
  it("se cobra solo la entrada, a su tarifa", () => {
    expect(costOfUsage(MODELO_JEV, { input: 1_000_000, cached: 0, output: 1_000_000 })).toBeCloseTo(0.042, 6);
  });
});
