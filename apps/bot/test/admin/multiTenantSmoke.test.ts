/**
 * Bug real de producción (2026-08-20): el dueño creó un segundo bot real
 * desde el panel (F5) y Telegram dejó de responder — resolveAgentConfig()
 * en el turno del agente se llamaba SIN el botId que ya había resuelto el
 * webhook, así que volvía a intentar adivinarlo de TODO el despliegue, que
 * revienta en cuanto hay 2+ bots. El mismo patrón apareció en Insights,
 * KB (guardar/eliminar/reindexar), Mejoras (ejecutar/aplicar/descartar/
 * quitar lección) y Campañas — cualquier acción que llamara a una función
 * compartida sin pasarle el bot ya resuelto por el guard.
 *
 * Esto ejercita esas acciones con una sesión de KontrolIA real y un SEGUNDO
 * bot en la MISMA organización — la única forma de reproducir el bug sin
 * esperar a que un dueño real lo pise en producción otra vez.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env } from "../../src/env";

const verifyAccessTokenMock = vi.fn();
vi.mock("../../src/admin/kontroliaAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/admin/kontroliaAuth")>();
  return { ...actual, verifyAccessToken: (...args: unknown[]) => verifyAccessTokenMock(...args) };
});

const generateTextMock = vi.fn();
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: (...args: unknown[]) => generateTextMock(...args) };
});

// El guardado de KB reindexa a pgvector — necesita un proveedor de embeddings
// real (API key) que aquí no hace falta probar; solo que indexDoc() no
// truene por resolver mal el bot.
vi.mock("../../src/ai/embeddings", () => ({
  getEmbeddingProvider: () => ({ embed: async (texts: string[]) => texts.map(() => new Array(1024).fill(0)) }),
}));

const { adminApp } = await import("../../src/admin/routes");
const { SESSION_COOKIE } = await import("../../src/admin/kontroliaAuth");
const { createTestDb, createSecondTestBot, TEST_BOT_ID } = await import("../helpers/pgSetup");
const { Db } = await import("../../src/db/client");
const { ConversationsRepo } = await import("../../src/db/conversations");
const { MessagesRepo } = await import("../../src/db/messages");
const { SuggestionsRepo } = await import("../../src/db/suggestions");

const SESSION = JSON.stringify({ accessToken: "at", refreshToken: "rt", expiresAt: Date.now() + 3600_000 });

// is_platform_admin:true a propósito — este archivo prueba bot-scoping (el
// bug real de 2+ bots en una organización), no el gate de permisos de
// admin/permissions.ts; platform_admin bypasea ambos guards nuevos sin que
// cada acción de aquí necesite su propio permiso inventado.
function claimsFor(organizationId: string) {
  return {
    sub: "u1",
    session_id: "s1",
    organization_id: organizationId,
    roles: [],
    permissions: [],
    is_platform_admin: true,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
}

function req(path: string, init?: RequestInit): Request {
  return new Request(`https://bot.test${path}`, {
    ...init,
    headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION)}`, ...init?.headers },
  });
}

let env: Env;
let otherBotId: string;

beforeEach(async () => {
  const db = await createTestDb();
  otherBotId = await createSecondTestBot(db);
  // El segundo bot cae en su propia organización por default — lo movemos a
  // la MISMA que TEST_BOT_ID: el bug real era "2 bots en la MISMA organización
  // activa", no "2 bots en organizaciones distintas" (eso ya andaba bien).
  await db.run("UPDATE bots SET organization_id = ? WHERE id = ?", [TEST_BOT_ID, otherBotId]);

  env = {
    DB: db.driver,
    DASHBOARD_PASSWORD: "x",
    DASHBOARD_BASE_URL: "https://bot.test",
    BOT_NAME: "Testi",
    BUSINESS_NAME: "Negocio de Prueba",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "15",
    OWNER_EMAIL: "duenio@ejemplo.com",
    ANTHROPIC_API_KEY: "sk-test",
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    OAUTH_CLIENT_ID: "client-123",
  } as unknown as Env;

  verifyAccessTokenMock.mockReset().mockResolvedValue({ claims: claimsFor(TEST_BOT_ID), user: { id: "u1" } });
  generateTextMock.mockReset().mockResolvedValue({ text: '{"lesson": null}' });
});

describe("con un segundo bot en la MISMA organización activa", () => {
  it("GET /insights no truena (countPending + el análisis en background)", async () => {
    const res = await adminApp.request(req("/insights"), {}, env);
    expect(res.status).toBe(200);
  });

  it("POST /insights/analyze no truena", async () => {
    const res = await adminApp.request(req("/insights/analyze", { method: "POST" }), {}, env);
    expect(res.status).toBe(302);
  });

  it("guardar un documento de KB no truena (indexDoc)", async () => {
    const res = await adminApp.request(
      req("/kb/save", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "title=Horarios&content=Abrimos+de+9+a+7",
      }),
      {},
      env,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("saved=1");
  });

  it("reindexar la KB no truena", async () => {
    const res = await adminApp.request(req("/kb/reindex", { method: "POST" }), {}, env);
    expect(res.status).toBe(302);
  });

  it("ejecutar Mejoras ahora no truena (detectKbGaps + detectLessons)", async () => {
    const res = await adminApp.request(req("/mejoras/run", { method: "POST" }), {}, env);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).not.toContain("undefined");
  });

  it("aplicar/descartar una sugerencia no truena", async () => {
    const db = await createTestDb();
    const suggestions = new SuggestionsRepo(db, TEST_BOT_ID);
    const id = await suggestions.createIfNew({
      kind: "leccion",
      fingerprint: "fp1",
      title: "Sé breve",
      payload: { lesson: "Sé breve", conversationId: "c1" },
      evidence: "prueba",
    });
    const res = await adminApp.request(req(`/mejoras/${id}/apply`, { method: "POST" }), {}, env);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("applied=1");
  });

  it("quitar una lección no truena (getLessons + saveLessons)", async () => {
    const res = await adminApp.request(
      req("/mejoras/lessons/remove", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "lesson=algo",
      }),
      {},
      env,
    );
    expect(res.status).toBe(302);
  });

  it("enviar una campaña no truena (sendCampaign)", async () => {
    const db = await createTestDb();
    const convs = new ConversationsRepo(db, TEST_BOT_ID);
    const msgs = new MessagesRepo(db, TEST_BOT_ID);
    const conv = await convs.getOrCreate("telegram", "u1", "Cliente");
    await msgs.append(conv.id, "user", "hola");

    const res = await adminApp.request(
      req("/campanas/send", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "segment=todos&campaign_key=promo1&freeform_text=Hola!",
      }),
      {},
      env,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).not.toContain("err=");
  });
});
