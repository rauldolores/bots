/**
 * Estado del servicio contra la base real: cuándo se abre y se cierra una
 * incidencia, que no se duplique, y lo que lee el panel.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { registrar, revisarEstadoServicio, leerEstado, incidenciasAbiertas, LENTO_MS } from "../../src/estado/revisar";
import { serviciosVigilados } from "../../src/estado/servicios";
import type { Env } from "../../src/env";

let db: Db;
let env: Env;

beforeEach(async () => {
  db = await createTestDb();
  env = { DB: db.driver, DASHBOARD_BASE_URL: "https://panel.test" } as unknown as Env;
});

const telegram = () => serviciosVigilados(env).find((s) => s.clave === "telegram")!;
const ok = (ms = 120) => ({ clave: "telegram", ok: true, ms, detalle: "HTTP 200" });
const falla = () => ({ clave: "telegram", ok: false, ms: null, detalle: "sin respuesta" });

async function estadoDe(clave: string) {
  return db.first<{ estado: string; fallas_seguidas: number }>("SELECT estado, fallas_seguidas FROM estado_servicios WHERE clave = ?", [clave]);
}

describe("registrar", () => {
  it("una falla sola no abre incidencia; la segunda seguida sí, y una sola vez", async () => {
    const t = telegram();
    expect(await registrar(db, t, falla(), 1000)).toBeNull();
    expect((await estadoDe("telegram"))?.estado).toBe("DEGRADADO");
    expect(await incidenciasAbiertas(db)).toHaveLength(0);

    const c = await registrar(db, t, falla(), 2000);
    expect(c?.accion).toBe("ABRIO");
    expect((await estadoDe("telegram"))?.estado).toBe("CAIDO");

    expect(await registrar(db, t, falla(), 3000)).toBeNull();
    const abiertas = await incidenciasAbiertas(db);
    expect(abiertas).toHaveLength(1);
    expect(abiertas[0].titulo).toBe("Falla en Telegram");
    expect(abiertas[0].mensaje).toContain("Ya estamos dando seguimiento");
    expect(abiertas[0].inicio).toBe(2000);
  });

  it("al volver a contestar se cierra sola y queda en el historial", async () => {
    const t = telegram();
    await registrar(db, t, falla(), 1000);
    await registrar(db, t, falla(), 2000);
    const c = await registrar(db, t, ok(), 5000);
    expect(c?.accion).toBe("CERRO");
    expect(await incidenciasAbiertas(db)).toHaveLength(0);
    expect((await estadoDe("telegram"))).toMatchObject({ estado: "OPERANDO", fallas_seguidas: 0 });

    const e = await leerEstado(env, 6000);
    expect(e.historial).toHaveLength(1);
    expect(e.historial[0].fin).toBe(5000);
    expect(e.historial[0].cierre).toContain("volvió a funcionar");
  });

  it("una falla suelta en medio de respuestas buenas no acumula", async () => {
    const t = telegram();
    await registrar(db, t, falla(), 1000);
    await registrar(db, t, ok(), 2000);
    expect(await registrar(db, t, falla(), 3000)).toBeNull();
    expect(await incidenciasAbiertas(db)).toHaveLength(0);
  });

  it("contestar lento es DEGRADADO, sin incidencia", async () => {
    expect(await registrar(db, telegram(), ok(LENTO_MS + 1), 1000)).toBeNull();
    expect((await estadoDe("telegram"))?.estado).toBe("DEGRADADO");
  });
});

describe("revisarEstadoServicio", () => {
  it("pregunta a cada servicio configurado y abre la incidencia del que no contesta dos veces", async () => {
    const pedidas: string[] = [];
    const fetchFalso = (async (url: string) => {
      pedidas.push(url);
      if (url.includes("telegram")) throw new Error("ECONNREFUSED");
      return new Response("", { status: url.endsWith("/health") ? 200 : 401 });
    }) as unknown as typeof fetch;

    expect(await revisarEstadoServicio(env, { now: 1000, fetch: fetchFalso })).toEqual([]);
    const cambios = await revisarEstadoServicio(env, { now: 2000, fetch: fetchFalso });
    expect(cambios.map((c) => `${c.clave} ${c.accion}`)).toEqual(["telegram ABRIO"]);

    // Sin VOICE_PUBLIC_BASE_URL ni KontrolIA configurados, esos no se preguntan.
    expect(pedidas.some((u) => u.includes("auth.kontrolia.io"))).toBe(false);
    expect(pedidas).toContain("https://panel.test/health");

    const e = await leerEstado(env, 3000);
    expect(e.servicios.find((s) => s.clave === "telegram")?.estado).toBe("CAIDO");
    expect(e.servicios.find((s) => s.clave === "base_datos")?.estado).toBe("OPERANDO");
    expect(e.servicios.find((s) => s.clave === "voz")).toBeUndefined();
    expect(e.abiertas).toHaveLength(1);
  });

  it("un servicio que aún no se revisa sale como SIN_DATOS", async () => {
    const e = await leerEstado(env);
    expect(e.servicios.length).toBeGreaterThan(5);
    expect(new Set(e.servicios.map((s) => s.estado))).toEqual(new Set(["SIN_DATOS"]));
  });
});
