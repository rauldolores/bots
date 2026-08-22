/**
 * /admin/campanas: la página de filtros dinámicos (reemplazó a los 7
 * "segmentos" fijos, ver src/segments.ts) — GET renderiza los facets +
 * presets, POST /preview recalcula el conteo en vivo por htmx, y POST /send
 * manda solo a quien cumple los filtros elegidos.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { adminApp } from "../../src/admin/routes";
import { ConversationsRepo } from "../../src/db/conversations";
import { LeadsRepo } from "../../src/db/leads";
import type { Env } from "../../src/env";

const PASSWORD = "secret123";
function basicAuthHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}
const AUTH = { Authorization: basicAuthHeader("admin", PASSWORD) };
const FORM = { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" };

let env: Env;
let convs: ConversationsRepo;

beforeEach(async () => {
  const d1 = (await createTestDb()) as any;
  env = {
    DB: d1.driver,
    BOT_NAME: "TestBot",
    BUSINESS_NAME: "Negocio de Prueba",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
    DASHBOARD_PASSWORD: PASSWORD,
    TELEGRAM_BOT_TOKEN: "tg-fake",
  } as unknown as Env;
  convs = new ConversationsRepo(d1, TEST_BOT_ID);
});

describe("GET /campanas", () => {
  it("renderiza los presets y los facets de filtro", async () => {
    const res = await adminApp.request("/campanas", { headers: AUTH }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Todos los que han escrito");
    expect(html).toContain("Leads nuevos sin contactar");
    expect(html).toContain("Estado del lead");
    expect(html).toContain("Sentimiento detectado por la IA");
    expect(html).toContain("audience-banner");
    expect(html).toContain("Resumen del envío");
  });
});

describe("POST /campanas/preview", () => {
  it("recalcula el conteo según los filtros elegidos", async () => {
    const a = await convs.getOrCreate("telegram", "u1");
    const db = new (await import("../../src/db/client")).Db(env.DB);
    await db.run(
      `INSERT INTO messages (id, conversation_id, bot_id, role, content, created_at) VALUES (?, ?, ?, 'user', 'hola', ?)`,
      [crypto.randomUUID(), a.id, TEST_BOT_ID, Date.now()],
    );
    await new LeadsRepo(db, TEST_BOT_ID).create({ conversationId: a.id, channelUserId: "u1", intent: "hola" });

    const resAll = await adminApp.request(
      "/campanas/preview",
      { method: "POST", headers: FORM, body: new URLSearchParams({ exclude_busy: "1" }) },
      env,
    );
    const htmlAll = await resAll.text();
    expect(htmlAll).toContain('font-weight:700">1</span>');
    expect(htmlAll).toContain(">Audiencia<");
    expect(htmlAll).toContain("Falta el nombre de la campaña"); // bloqueador: campaign_key no viene en este POST

    const resFiltered = await adminApp.request(
      "/campanas/preview",
      { method: "POST", headers: FORM, body: new URLSearchParams({ lead_status: "contacted", exclude_busy: "1" }) },
      env,
    );
    const htmlFiltered = await resFiltered.text();
    expect(htmlFiltered).toContain("Nadie cumple estos filtros todavía");
  });
});

describe("POST /campanas/send", () => {
  it("exige nombre de campaña y mensaje/plantilla", async () => {
    const res = await adminApp.request(
      "/campanas/send",
      { method: "POST", headers: FORM, body: new URLSearchParams({}) },
      env,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("err=");
  });
});
