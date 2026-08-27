/**
 * El panel de Seguimientos (F8 fase C): crear/editar secuencias de nurture,
 * y — nuevo — la galería de plantillas para no tener que redactar objetivo/
 * pasos desde cero.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { adminApp } from "../../src/admin/routes";
import { Db } from "../../src/db/client";
import { NurtureSequencesRepo } from "../../src/db/nurtureSequences";
import { NURTURE_TEMPLATES } from "../../src/nurture/templates";
import type { Env } from "../../src/env";

const PASSWORD = "secret123";
const AUTH = { Authorization: `Basic ${Buffer.from(`admin:${PASSWORD}`).toString("base64")}` };

let db: Db;
let env: Env;

beforeEach(async () => {
  db = await createTestDb();
  env = {
    DB: db.driver,
    DASHBOARD_PASSWORD: PASSWORD,
    BOT_NAME: "Testi",
    BUSINESS_NAME: "Negocio de Prueba",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "15",
    DASHBOARD_BASE_URL: "http://localhost:8787",
    ANTHROPIC_API_KEY: "sk-test",
  } as unknown as Env;
});

function post(path: string, body: string) {
  return adminApp.request(
    path,
    { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body },
    env,
  );
}

describe("crear secuencia", () => {
  it("la guarda con nombre, objetivo y pasos", async () => {
    const body = new URLSearchParams();
    body.append("name", "Mi secuencia");
    body.append("goal", "Cerrar la venta");
    body.append("step_hours", "24");
    body.append("step_instruction", "Pregunta si tiene dudas");
    const res = await post("/seguimientos/nueva", body.toString());
    expect(res.status).toBe(302);

    const seqs = await new NurtureSequencesRepo(db, TEST_BOT_ID).list();
    expect(seqs).toHaveLength(1);
    expect(seqs[0].name).toBe("Mi secuencia");
    expect(seqs[0].steps).toEqual([{ afterHours: 24, instruction: "Pregunta si tiene dudas" }]);
  });
});

// Bug real reportado: "les pongo editar y les activo la casilla pero siguen
// apagadas". Causa: el checkbox "Activa" va acompañado de un
// <input type="hidden" name="enabled" value="0"> que, con la casilla
// MARCADA, un navegador real manda JUNTO con "enabled=1" (el hidden primero,
// tal como aparece en el HTML) — `form.get()` devolvía el primero ("0")
// siempre, sin importar la casilla. Corregido a `getAll().includes("1")`.
describe("activar/desactivar una secuencia (checkbox + hidden)", () => {
  async function crearApagada(): Promise<string> {
    const body = new URLSearchParams();
    body.append("name", "Mi secuencia");
    body.append("goal", "Cerrar la venta");
    body.append("step_hours", "24");
    body.append("step_instruction", "Pregunta si tiene dudas");
    await post("/seguimientos/nueva", body.toString());
    const [seq] = await new NurtureSequencesRepo(db, TEST_BOT_ID).list();
    // Apagarla primero, para partir de un estado conocido en false.
    const off = new URLSearchParams();
    off.append("name", seq.name);
    off.append("goal", seq.goal);
    off.append("step_hours", "24");
    off.append("step_instruction", "Pregunta si tiene dudas");
    off.append("enabled", "0");
    await post(`/seguimientos/${seq.id}`, off.toString());
    expect((await new NurtureSequencesRepo(db, TEST_BOT_ID).getById(seq.id))?.enabled).toBe(false);
    return seq.id;
  }

  it("marcar la casilla (hidden Y checkbox juntos, como manda un navegador real) SÍ la activa", async () => {
    const id = await crearApagada();
    // El hidden (value=0) Y el checkbox (value=1) juntos, en ese orden —
    // exactamente lo que manda un navegador con la casilla marcada.
    const on = new URLSearchParams();
    on.append("name", "Mi secuencia");
    on.append("goal", "Cerrar la venta");
    on.append("step_hours", "24");
    on.append("step_instruction", "Pregunta si tiene dudas");
    on.append("enabled", "0");
    on.append("enabled", "1");
    const res = await post(`/seguimientos/${id}`, on.toString());
    expect(res.status).toBe(302);
    expect((await new NurtureSequencesRepo(db, TEST_BOT_ID).getById(id))?.enabled).toBe(true);
  });
});

// Plantillas — ahorrarle al dueño escribir objetivo/pasos desde cero.
describe("plantillas de seguimiento", () => {
  it("la galería muestra las plantillas curadas", async () => {
    const res = await adminApp.request("/seguimientos/plantillas", { headers: AUTH }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    for (const t of NURTURE_TEMPLATES) expect(html).toContain(t.label);
  });

  it("usar una plantilla crea la secuencia real (mismo camino que crearla a mano) y manda a editarla", async () => {
    const template = NURTURE_TEMPLATES.find((t) => t.slug === "cotizacion-sin-cerrar")!;
    const res = await post(`/seguimientos/plantillas/${template.slug}/usar`, "");
    expect(res.status).toBe(302);

    const seqs = await new NurtureSequencesRepo(db, TEST_BOT_ID).list();
    expect(seqs).toHaveLength(1);
    expect(seqs[0].name).toBe(template.name);
    expect(seqs[0].goal).toBe(template.goal);
    expect(seqs[0].steps).toEqual(template.steps);
    expect(res.headers.get("location")).toBe(`/admin/seguimientos/${seqs[0].id}/editar`);
  });

  it("la secuencia creada desde plantilla se puede editar y guardar como cualquier otra", async () => {
    const template = NURTURE_TEMPLATES[0];
    await post(`/seguimientos/plantillas/${template.slug}/usar`, "");
    const [seq] = await new NurtureSequencesRepo(db, TEST_BOT_ID).list();

    const body = new URLSearchParams();
    body.append("name", `${template.name} (ajustada)`);
    body.append("goal", template.goal);
    template.steps.forEach((s) => {
      body.append("step_hours", String(s.afterHours));
      body.append("step_instruction", s.instruction);
    });
    body.append("enabled", "1");
    const res = await post(`/seguimientos/${seq.id}`, body.toString());
    expect(res.status).toBe(302);

    const fresh = await new NurtureSequencesRepo(db, TEST_BOT_ID).getById(seq.id);
    expect(fresh?.name).toBe(`${template.name} (ajustada)`);
  });

  it("una plantilla que no existe responde 404 sin crear nada", async () => {
    const res = await post("/seguimientos/plantillas/no-existe/usar", "");
    expect(res.status).toBe(404);
    expect(await new NurtureSequencesRepo(db, TEST_BOT_ID).list()).toHaveLength(0);
  });

  it("GET /seguimientos/plantillas no choca con /seguimientos/:id/editar (orden de rutas)", async () => {
    const res = await adminApp.request("/seguimientos/plantillas", { headers: AUTH }, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Plantillas de seguimiento");
  });
});
