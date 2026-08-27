/**
 * Renderiza TODAS las vistas del panel contra un Postgres real.
 *
 * Existe por un defecto concreto: `routes.test.ts` prueba el ruteo con un
 * driver simulado, así que su SQL nunca se ejecuta. Al migrar de D1 quedó una
 * llamada a `date(created_at / 1000, 'unixepoch')` — función de SQLite — que
 * pasó typecheck y los 490 tests, y solo apareció al abrir el panel: 500 en
 * Resumen, Costos y Estadísticas.
 *
 * Esto no comprueba el contenido de cada vista (de eso ya se encargan los tests
 * específicos). Solo que su SQL corre en el motor real.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, createSecondTestBot, TEST_BOT_ID } from "../helpers/pgSetup";
import { adminApp } from "../../src/admin/routes";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { LeadsRepo } from "../../src/db/leads";
import type { Db } from "../../src/db/client";
import type { Env } from "../../src/env";

const PASSWORD = "secret123";
const AUTH = { Authorization: `Basic ${Buffer.from(`admin:${PASSWORD}`).toString("base64")}` };

// Todas las vistas de solo lectura del panel.
const VISTAS = [
  "/overview",
  "/stats",
  "/costs",
  "/kb",
  "/kb/new",
  "/habilidades",
  "/habilidades/nueva",
  "/habilidades/plantillas",
  "/seguimientos",
  "/seguimientos/nueva",
  "/seguimientos/plantillas",
  "/mejoras",
  "/conversations",
  "/insights",
  "/agente",
  "/leads",
  "/tickets",
  "/calendario",
  "/calendario?month=2026-08",
  "/conexiones",
  "/campanas",
  "/config",
  "/projects",
  "/upgrade",
];

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
    OWNER_EMAIL: "duenio@ejemplo.com",
    ANTHROPIC_API_KEY: "sk-test",
  } as unknown as Env;
});

describe("el panel renderiza con la base vacía", () => {
  for (const ruta of VISTAS) {
    it(`GET ${ruta}`, async () => {
      const res = await adminApp.request(ruta, { headers: AUTH }, env);
      expect(res.status).toBe(200);
    });
  }
});

describe("el panel renderiza con datos", () => {
  beforeEach(async () => {
    // Datos suficientes para que las agregaciones por día, el heatmap, el
    // funnel y los costos tengan filas de verdad que agrupar.
    const convs = new ConversationsRepo(db, TEST_BOT_ID);
    const msgs = new MessagesRepo(db, TEST_BOT_ID);
    const leads = new LeadsRepo(db, TEST_BOT_ID);

    for (const u of ["u1", "u2"]) {
      const conv = await convs.getOrCreate("telegram", u, `Cliente ${u}`);
      await msgs.append(conv.id, "user", "hola, cuánto cuesta?");
      await msgs.append(conv.id, "assistant", "Cuesta $100.", {
        modelUsed: "claude-haiku-4-5-20251001",
        inputTokens: 120,
        outputTokens: 40,
        cachedInputTokens: 0,
        toolCalls: [{ toolName: "searchKb", input: { query: "precio" } }],
      });
      await leads.create({
        name: `Cliente ${u}`,
        contact: "+521234",
        intent: "cotización",
        conversationId: conv.id,
        channelUserId: u,
      });
    }
  });

  for (const ruta of VISTAS) {
    it(`GET ${ruta}`, async () => {
      const res = await adminApp.request(ruta, { headers: AUTH }, env);
      expect(res.status).toBe(200);
    });
  }

  it("exporta leads a CSV", async () => {
    const res = await adminApp.request("/leads/export.csv", { headers: AUTH }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
  });
});

// Regresión: con 2+ bots y Basic Auth, resolveAdminTenant lanzaba y TODAS las
// pantallas respondían 500 — no solo alguna. Desde que el panel puede crear
// bots, ese estado deja de ser raro.
describe("el panel sobrevive con más de un bot (Basic Auth)", () => {
  beforeEach(async () => {
    await createSecondTestBot(db);
  });

  for (const ruta of VISTAS) {
    it(`GET ${ruta}`, async () => {
      const res = await adminApp.request(ruta, { headers: AUTH }, env);
      expect(res.status).toBe(200);
    });
  }

  it("/projects ofrece los dos bots, marcando el activo", async () => {
    const res = await adminApp.request("/projects", { headers: AUTH }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { localBots?: { id: string; current: boolean }[] };
    expect(body.localBots).toHaveLength(2);
    expect(body.localBots!.filter((b) => b.current)).toHaveLength(1);
  });

  it("cambiar de bot deja la cookie puesta; un bot inventado se rechaza", async () => {
    const otro = (await db.all<{ id: string }>("SELECT id FROM bots WHERE id != ?", [TEST_BOT_ID]))[0];
    const ok = await adminApp.request(
      "/switch-bot",
      {
        method: "POST",
        headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" },
        body: `bot_id=${otro.id}`,
      },
      env,
    );
    expect(ok.status).toBe(302);
    expect(ok.headers.get("set-cookie") ?? "").toContain(otro.id);

    const malo = await adminApp.request(
      "/switch-bot",
      {
        method: "POST",
        headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" },
        body: "bot_id=00000000-0000-0000-0000-000000000999",
      },
      env,
    );
    expect(malo.status).toBe(400);
  });
});
