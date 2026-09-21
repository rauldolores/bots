/**
 * De quién es la llave de ElevenLabs (channels/voice/elevenlabsKey.ts) y
 * cómo se gatea la voz por plan en el panel.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import type { Env } from "../../src/env";

const hayCupoMock = vi.fn();
vi.mock("../../src/billing/kontrolia", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/billing/kontrolia")>();
  return { ...actual, hayCupo: (...a: unknown[]) => hayCupoMock(...a), contarUso: async () => null };
});

// La IA del chat no es lo que se prueba aquí: que no consulte suscripciones.
vi.mock("../../src/billing/suscripcion", () => ({
  estadoDeSuscripcion: async () => ({ status: "active", planSlug: "plan-pro" }),
  olvidarSuscripcion: () => {},
}));

const prepararMock = vi.fn();
vi.mock("../../src/channels/voice/elevenlabsSetup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/channels/voice/elevenlabsSetup")>();
  return { ...actual, prepararAgenteElevenLabs: (...a: unknown[]) => prepararMock(...a) };
});

const { llaveDeElevenLabs, vozIncluidaEnElPlan } = await import("../../src/channels/voice/elevenlabsKey");

const PASSWORD = "secreto";
const AUTH = { Authorization: `Basic ${Buffer.from(`admin:${PASSWORD}`, "utf-8").toString("base64")}` };

const uso = (limit: number | null) => ({ key: "llamadas", used: 0, limit, remaining: limit, period: "month", periodStart: "2026-09-01", exceeded: false, planSlug: "x" });

let db: Db;
let env: Env;
let settings: SettingsRepo;

beforeEach(async () => {
  db = await createTestDb();
  settings = new SettingsRepo(db, TEST_BOT_ID);
  hayCupoMock.mockReset().mockResolvedValue({ ok: true, usage: uso(400) });
  prepararMock.mockReset().mockResolvedValue({ ok: true });
  env = {
    DB: db.driver,
    BOT_NAME: "Testi",
    BUSINESS_NAME: "Negocio",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "15",
    DASHBOARD_PASSWORD: PASSWORD,
    ANTHROPIC_API_KEY: "sk-ant",
    OPENAI_API_KEY: "sk-openai",
    KONTROLIA_APPLICATION_API_KEY: "kapp_test",
    ELEVENLABS_API_KEY: "sk_kontrolia",
  } as unknown as Env;
});

describe("llaveDeElevenLabs", () => {
  it("la del bot gana; si no hay, la de Kontrolia; si no hay ninguna, null", () => {
    expect(llaveDeElevenLabs(env, { [SETTING_KEYS.voiceElevenLabsApiKey]: "sk_propia" })).toEqual({ apiKey: "sk_propia", origen: "propia" });
    expect(llaveDeElevenLabs(env, {})).toEqual({ apiKey: "sk_kontrolia", origen: "kontrolia" });
    expect(llaveDeElevenLabs({ ELEVENLABS_API_KEY: "" }, { [SETTING_KEYS.voiceElevenLabsApiKey]: "  " })).toBeNull();
  });
});

describe("vozIncluidaEnElPlan", () => {
  it("límite 0 = sin voz; >0 = con minutos; null = sin tope; sin organización = como siempre", async () => {
    hayCupoMock.mockResolvedValue({ ok: false, usage: uso(0) });
    expect(await vozIncluidaEnElPlan(env, "org-1")).toMatchObject({ incluida: false, minutos: 0 });
    hayCupoMock.mockResolvedValue({ ok: true, usage: uso(400) });
    expect(await vozIncluidaEnElPlan(env, "org-1")).toMatchObject({ incluida: true, minutos: 400 });
    hayCupoMock.mockResolvedValue({ ok: true, usage: uso(null) });
    expect(await vozIncluidaEnElPlan(env, "org-1")).toMatchObject({ incluida: true, minutos: null });
    expect(await vozIncluidaEnElPlan(env, null)).toMatchObject({ incluida: true, minutos: null });
    expect(hayCupoMock).toHaveBeenCalledTimes(3);
  });
});

describe("credencialesElevenLabs — el puente usa la llave de Kontrolia", () => {
  it("sin llave propia y con agente ya creado, conecta con la del entorno", async () => {
    const { credencialesElevenLabs } = await import("../../src/channels/voice/callBridge");
    await settings.set(SETTING_KEYS.voiceElevenLabsAgentId, "agent-1");
    await settings.set(SETTING_KEYS.voiceElevenLabsConfigHash, "x");
    const r = await credencialesElevenLabs(db, TEST_BOT_ID, env);
    expect(r).toEqual({ apiKey: "sk_kontrolia", agentId: "agent-1" });
  });

  it("sin ninguna llave, null: no hay a qué conectarse", async () => {
    const { credencialesElevenLabs } = await import("../../src/channels/voice/callBridge");
    await settings.set(SETTING_KEYS.voiceElevenLabsAgentId, "agent-1");
    expect(await credencialesElevenLabs(db, TEST_BOT_ID, { ...env, ELEVENLABS_API_KEY: "" } as Env)).toBeNull();
  });
});

describe("/admin/config — la pestaña de voz según el plan", () => {
  it("con minutos en el plan: no pide llave y dice que va incluida", async () => {
    const { adminApp } = await import("../../src/admin/routes");
    const html = await (await adminApp.request("/config", { headers: AUTH }, env)).text();
    expect(html).toContain('data-testid="voz-incluida"');
    expect(html).toContain("400 minutos al mes");
    expect(html).not.toContain(`name="${SETTING_KEYS.voiceElevenLabsApiKey}"`);
  });

  it("sin minutos (Impulso): no hay nada que configurar, solo subir de plan", async () => {
    hayCupoMock.mockResolvedValue({ ok: false, usage: uso(0) });
    const { adminApp } = await import("../../src/admin/routes");
    const html = await (await adminApp.request("/config", { headers: AUTH }, env)).text();
    expect(html).toContain('data-testid="voz-sin-plan"');
    expect(html).toContain("/admin/plan");
    expect(html).not.toContain('id="voz-11labs"');
  });

  it("con llave propia guardada: lo dice y deja quitarla", async () => {
    await settings.setSecret(SETTING_KEYS.voiceElevenLabsApiKey, "sk_propia_9876");
    const { adminApp } = await import("../../src/admin/routes");
    const html = await (await adminApp.request("/config", { headers: AUTH }, env)).text();
    expect(html).toContain("tu propia cuenta de ElevenLabs");
    expect(html).toContain("····9876");
    expect(html).toContain('name="voice_elevenlabs_api_key_clear"');
  });

  it("instalación propia (sin KontrolIA): se sigue pidiendo la llave como siempre", async () => {
    const { adminApp } = await import("../../src/admin/routes");
    const propia = { ...env, KONTROLIA_APPLICATION_API_KEY: "" } as Env;
    // Sin API key de KontrolIA, hayCupo ni se llama y el bot tiene org: la
    // ruta pasa `voz` igual, así que aquí lo que manda es que hayCupo devuelva "sin dato".
    hayCupoMock.mockResolvedValue({ ok: true, usage: null });
    const html = await (await adminApp.request("/config", { headers: AUTH }, propia)).text();
    expect(html).toContain('id="voz-11labs"');
  });
});

describe("POST /admin/config — el agente en ElevenLabs", () => {
  const guardar = async (form: Record<string, string>) => {
    const { adminApp } = await import("../../src/admin/routes");
    return adminApp.request(
      "/config",
      { method: "POST", body: new URLSearchParams(form), headers: { ...AUTH, "content-type": "application/x-www-form-urlencoded" } },
      env,
    );
  };

  it("con minutos en el plan se prepara con la llave de Kontrolia, sin que el dueño pegue nada", async () => {
    await guardar({ [SETTING_KEYS.voiceElevenLabsVoiceId]: "" });
    expect(prepararMock).toHaveBeenCalledTimes(1);
    expect(prepararMock.mock.calls[0][2]).toBe("sk_kontrolia");
  });

  it("sin minutos en el plan NO se crea agente en nuestra cuenta", async () => {
    hayCupoMock.mockResolvedValue({ ok: false, usage: uso(0) });
    await guardar({});
    expect(prepararMock).not.toHaveBeenCalled();
  });

  it("quitar la llave propia olvida el agente creado en ESA cuenta", async () => {
    await settings.setSecret(SETTING_KEYS.voiceElevenLabsApiKey, "sk_propia");
    await settings.set(SETTING_KEYS.voiceElevenLabsAgentId, "agent-de-su-cuenta");
    await settings.set(SETTING_KEYS.voiceElevenLabsConfigHash, "h");
    await guardar({ voice_elevenlabs_api_key_clear: "1" });
    expect(await settings.getSecret(SETTING_KEYS.voiceElevenLabsApiKey)).toBeFalsy();
    expect((await settings.get(SETTING_KEYS.voiceElevenLabsAgentId)) ?? "").toBe("");
    // Y se vuelve a preparar, ahora con la nuestra.
    expect(prepararMock.mock.calls.at(-1)?.[2]).toBe("sk_kontrolia");
  });
});
