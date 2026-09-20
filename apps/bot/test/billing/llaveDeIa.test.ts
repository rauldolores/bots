/**
 * De quién es la llave con la que piensa el bot (billing/llaveDeIa.ts).
 *
 * La suscripción va mockeada (vive en kontrolia_auth, que no existe en el
 * esquema de pruebas); lo que se prueba es la regla y que TODOS los caminos
 * la respeten: el turno, los que piensan fuera del turno (loadLlmOverrides),
 * el runner, el sandbox y las pantallas.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { MessagesRepo } from "../../src/db/messages";
import type { Env } from "../../src/env";

const suscripcionMock = vi.fn();
vi.mock("../../src/billing/suscripcion", () => ({
  estadoDeSuscripcion: (...a: unknown[]) => suscripcionMock(...a),
  olvidarSuscripcion: () => {},
}));

// Con API key de KontrolIA en el env, hayCupo/contarUso irían de verdad al
// auth-server. Aquí no se prueba el cupo: siempre hay.
vi.mock("../../src/billing/kontrolia", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/billing/kontrolia")>();
  return {
    ...actual,
    hayCupo: async () => ({ ok: true, usage: null }),
    contarUso: async () => null,
  };
});

const notifyOwnerMock = vi.fn();
vi.mock("../../src/tools/handoffHuman", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/tools/handoffHuman")>();
  return { ...actual, notifyOwner: (...a: unknown[]) => notifyOwnerMock(...a) };
});

const { politicaDeIa, aplicarPolitica, MODELO_INCLUIDO, avisarSinLlave, explicacionDeIa } = await import(
  "../../src/billing/llaveDeIa"
);
const { createModel, SinLlaveDeIaError } = await import("../../src/llm/provider");
const { loadLlmOverrides, resolveAgentConfig } = await import("../../src/settings-loader");
const { ingestMessage } = await import("../../src/agent/runner");

let db: Db;
let env: Env;
let settings: SettingsRepo;

const PASSWORD = "secreto";
const AUTH = { Authorization: `Basic ${Buffer.from(`admin:${PASSWORD}`, "utf-8").toString("base64")}` };

/** El SaaS: con API key de KontrolIA y llave de OpenAI de Kontrolia en el entorno. */
const SAAS = {
  KONTROLIA_APPLICATION_API_KEY: "kapp_test",
  ANTHROPIC_API_KEY: "sk-ant-sistema",
  OPENAI_API_KEY: "sk-openai-kontrolia",
};

beforeEach(async () => {
  db = await createTestDb();
  settings = new SettingsRepo(db, TEST_BOT_ID);
  suscripcionMock.mockReset().mockResolvedValue({ status: "active", planSlug: "plan-pro" });
  notifyOwnerMock.mockReset().mockResolvedValue(undefined);
  env = {
    DB: db.driver,
    BOT_NAME: "Testi",
    BUSINESS_NAME: "Negocio",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "15",
    DASHBOARD_PASSWORD: PASSWORD,
    ...SAAS,
  } as unknown as Env;
});

describe("politicaDeIa — la regla", () => {
  it("con llave propia: 'propia', sin importar el plan", async () => {
    await settings.setSecret(SETTING_KEYS.llmApiKey, "sk-del-dueno");
    suscripcionMock.mockResolvedValue({ status: "trialing", planSlug: "plan-impulso" });
    expect(await politicaDeIa(env, db, TEST_BOT_ID)).toEqual({ modo: "propia" });
    expect(suscripcionMock).not.toHaveBeenCalled();
  });

  it("plan pagado sin llave propia: 'incluida' con el modelo barato fijo", async () => {
    expect(await politicaDeIa(env, db, TEST_BOT_ID)).toEqual({ modo: "incluida", modelo: MODELO_INCLUIDO });
  });

  it("past_due (gracia del auth-server) sigue siendo pagado", async () => {
    suscripcionMock.mockResolvedValue({ status: "past_due", planSlug: "plan-pro" });
    expect((await politicaDeIa(env, db, TEST_BOT_ID)).modo).toBe("incluida");
  });

  it("prueba gratis sin llave propia: 'sin_llave' por trial — la prueba se hace con la llave del dueño", async () => {
    suscripcionMock.mockResolvedValue({ status: "trialing", planSlug: "plan-impulso" });
    expect(await politicaDeIa(env, db, TEST_BOT_ID)).toEqual({ modo: "sin_llave", motivo: "trial" });
  });

  it("sin suscripción, o cancelada: 'sin_llave' por sin_plan", async () => {
    suscripcionMock.mockResolvedValue(null);
    expect(await politicaDeIa(env, db, TEST_BOT_ID)).toEqual({ modo: "sin_llave", motivo: "sin_plan" });
    suscripcionMock.mockResolvedValue({ status: "canceled", planSlug: "plan-pro" });
    expect(await politicaDeIa(env, db, TEST_BOT_ID)).toEqual({ modo: "sin_llave", motivo: "sin_plan" });
  });

  it("plan pagado pero el entorno no tiene OPENAI_API_KEY: es problema nuestro, no del dueño", async () => {
    env = { ...env, OPENAI_API_KEY: "" } as Env;
    expect(await politicaDeIa(env, db, TEST_BOT_ID)).toEqual({ modo: "sin_llave", motivo: "sin_llave_del_sistema" });
  });

  it("no es el SaaS (sin API key de KontrolIA): 'libre', lo de siempre", async () => {
    env = { ...env, KONTROLIA_APPLICATION_API_KEY: "" } as Env;
    expect(await politicaDeIa(env, db, TEST_BOT_ID)).toEqual({ modo: "libre" });
    expect(suscripcionMock).not.toHaveBeenCalled();
  });

  it("si la suscripción no se puede leer, se degrada a 'libre' en vez de dejar mudo al bot", async () => {
    suscripcionMock.mockRejectedValue(new Error("base caída"));
    expect(await politicaDeIa(env, db, TEST_BOT_ID)).toEqual({ modo: "libre" });
  });
});

describe("aplicarPolitica / createModel — que ningún camino caiga a la llave del entorno", () => {
  it("incluida: OpenAI con la llave de Kontrolia y el modelo fijo, aunque el dueño haya elegido otro proveedor/modelo", () => {
    const ov = aplicarPolitica(env, { provider: "anthropic", model: "claude-opus-4-6" }, { modo: "incluida", modelo: MODELO_INCLUIDO });
    expect(ov).toEqual({ provider: "openai", apiKey: "sk-openai-kontrolia", model: MODELO_INCLUIDO });
    const smart = createModel(env, "smart", ov);
    expect(smart.provider).toBe("openai");
    expect(smart.modelId).toBe(MODELO_INCLUIDO); // ni el tier "smart" lo sube
  });

  it("sin_llave: createModel LANZA en vez de usar ANTHROPIC_API_KEY del entorno", () => {
    const ov = aplicarPolitica(env, {}, { modo: "sin_llave", motivo: "trial" });
    expect(() => createModel(env, "fast", ov)).toThrow(SinLlaveDeIaError);
  });

  it("propia y libre: no tocan lo que el dueño configuró", () => {
    const ov = { provider: "xai", apiKey: "xai-123", model: "grok-4" };
    expect(aplicarPolitica(env, ov, { modo: "propia" })).toBe(ov);
    expect(aplicarPolitica(env, ov, { modo: "libre" })).toBe(ov);
  });

  it("loadLlmOverrides (CRM, seguimientos, insights) también pasa por la política", async () => {
    expect(await loadLlmOverrides(env, TEST_BOT_ID)).toMatchObject({ provider: "openai", model: MODELO_INCLUIDO });
    suscripcionMock.mockResolvedValue({ status: "trialing", planSlug: "plan-impulso" });
    expect(await loadLlmOverrides(env, TEST_BOT_ID)).toEqual({ bloqueo: "trial" });
  });

  it("resolveAgentConfig expone la política y, con la incluida, no arrastra respaldo del dueño", async () => {
    await settings.set(SETTING_KEYS.llmBackupProvider, "anthropic");
    await settings.setSecret(SETTING_KEYS.llmBackupApiKey, "sk-ant-respaldo");
    const cfg = await resolveAgentConfig(env, [], TEST_BOT_ID);
    expect(cfg.ia).toEqual({ modo: "incluida", modelo: MODELO_INCLUIDO });
    expect(cfg.llm.model).toBe(MODELO_INCLUIDO);
    expect(cfg.llmBackup).toEqual({});
  });
});

describe("runner — sin llave, el bot no programa turno y avisa al dueño", () => {
  const entra = () => ingestMessage(env, { channel: "twilio", channelUserId: "+5215512345678", text: "Hola" }, TEST_BOT_ID);

  it("en trial sin llave: no hay turno, y al dueño se le avisa UNA vez al día", async () => {
    suscripcionMock.mockResolvedValue({ status: "trialing", planSlug: "plan-impulso" });
    const r1 = await entra();
    expect(r1.scheduledInMs).toBeNull();
    await entra();
    await entra();
    expect(notifyOwnerMock).toHaveBeenCalledTimes(1);
    const aviso = notifyOwnerMock.mock.calls[0][1] as { reason: string; summary: string; ruta: string };
    expect(aviso.reason).toMatch(/falta tu llave/i);
    expect(aviso.summary).toMatch(/prueba gratis/i);
    expect(aviso.ruta).toBe("/admin/config?section=modelo");
  });

  it("con plan pagado: el turno se programa normal", async () => {
    const r = await entra();
    expect(r.scheduledInMs).not.toBeNull();
    expect(notifyOwnerMock).not.toHaveBeenCalled();
  });

  it("en trial CON llave propia: el turno se programa normal", async () => {
    suscripcionMock.mockResolvedValue({ status: "trialing", planSlug: "plan-impulso" });
    await settings.setSecret(SETTING_KEYS.llmApiKey, "sk-del-dueno");
    const r = await entra();
    expect(r.scheduledInMs).not.toBeNull();
  });

  it("el aviso se repite pasado un día", async () => {
    await avisarSinLlave(env, TEST_BOT_ID, "trial");
    await settings.set("sin_ia_avisado_at", String(Date.now() - 25 * 3600_000));
    expect(await avisarSinLlave(env, TEST_BOT_ID, "trial")).toBe(true);
    expect(notifyOwnerMock).toHaveBeenCalledTimes(2);
  });
});

describe("lo que ve el dueño", () => {
  it("la explicación de cada caso dice qué hacer, y solo culpa a Kontrolia cuando es nuestro", () => {
    expect(explicacionDeIa({ modo: "sin_llave", motivo: "trial" }).detalle).toMatch(/tu propia llave/i);
    expect(explicacionDeIa({ modo: "sin_llave", motivo: "sin_plan" }).detalle).toMatch(/plan/i);
    expect(explicacionDeIa({ modo: "sin_llave", motivo: "sin_llave_del_sistema" }).detalle).toMatch(/nuestro lado/i);
    expect(explicacionDeIa({ modo: "incluida", modelo: MODELO_INCLUIDO }).alerta).toBe(false);
  });

  it("el sandbox contesta con la explicación en vez de quedarse callado", async () => {
    suscripcionMock.mockResolvedValue({ status: "trialing", planSlug: "plan-impulso" });
    const { adminApp } = await import("../../src/admin/routes");
    const { trainingConversationId } = await import("../../src/admin/views/sandbox");
    const form = new URLSearchParams({ texto: "hola bot" });
    const res = await adminApp.request(
      "/entrenamiento/mensaje",
      { method: "POST", body: form, headers: { ...AUTH, "content-type": "application/x-www-form-urlencoded" } },
      env,
    );
    expect(res.status).toBe(200);
    const convId = await trainingConversationId(env, TEST_BOT_ID);
    const msgs = await new MessagesRepo(db, TEST_BOT_ID).lastN(convId, 5);
    expect(msgs.some((m) => m.role === "assistant" && /llave de IA|tu propia llave/i.test(m.content))).toBe(true);
  });

  it("/admin/config muestra el estado, y /admin/overview la alerta cuando no hay IA", async () => {
    suscripcionMock.mockResolvedValue({ status: "trialing", planSlug: "plan-impulso" });
    const { adminApp } = await import("../../src/admin/routes");
    const config = await (await adminApp.request("/config", { headers: AUTH }, env)).text();
    expect(config).toContain('data-testid="estado-ia" data-modo="sin_llave"');
    expect(config).toMatch(/falta tu llave de IA/);
    const overview = await (await adminApp.request("/overview", { headers: AUTH }, env)).text();
    expect(overview).toContain('data-testid="alerta-sin-ia"');
    expect(overview).toContain("sin IA");

    suscripcionMock.mockResolvedValue({ status: "active", planSlug: "plan-pro" });
    const config2 = await (await adminApp.request("/config", { headers: AUTH }, env)).text();
    expect(config2).toContain('data-modo="incluida"');
    const overview2 = await (await adminApp.request("/overview", { headers: AUTH }, env)).text();
    expect(overview2).not.toContain('data-testid="alerta-sin-ia"');
    expect(overview2).toContain(`${MODELO_INCLUIDO} · incluido`);
  });
});
