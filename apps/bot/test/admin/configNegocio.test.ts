/**
 * /admin/config → "Información del negocio" + "Instrucciones avanzadas":
 * guarda giro, idioma, país, moneda, campos dinámicos y catálogo en
 * bots.niche/bots.language/bots.config (JSONB), no en el KV plano de
 * settings — y nunca tumba el guardado completo si el JSON llega mal
 * formado (solo esa llave del patch se ignora).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { adminApp } from "../../src/admin/routes";
import { BotsRepo } from "../../src/db/bots";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import type { Env } from "../../src/env";

const PASSWORD = "secret123";
function basicAuthHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}
const AUTH = { Authorization: basicAuthHeader("admin", PASSWORD) };

let env: Env;
let db: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  db = (await createTestDb()) as any;
  env = {
    DB: db.driver,
    ANTHROPIC_API_KEY: "sk-test",
    BOT_NAME: "TestBot",
    BUSINESS_NAME: "Negocio de Prueba",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
    DASHBOARD_PASSWORD: PASSWORD,
  } as unknown as Env;
});

async function postConfig(fields: Record<string, string>) {
  const form = new URLSearchParams(fields);
  return adminApp.request(
    "/config",
    { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() },
    env,
  );
}

describe("POST /admin/config — negocio (giro, idioma, país, moneda, campos dinámicos, catálogo)", () => {
  it("guarda niche y bot_language en las columnas de bots, no en settings", async () => {
    const res = await postConfig({ niche: "barbería", bot_language: "en" });
    expect(res.status).toBe(302);
    const bot = await new BotsRepo(db).getById(TEST_BOT_ID);
    expect(bot?.niche).toBe("barbería");
    expect(bot?.language).toBe("en");
  });

  it("guarda country/currency/custom_fields_json/catalog_json/catalog_source en bots.config vía un solo mergeConfig", async () => {
    const res = await postConfig({
      country: "México",
      currency: "MXN",
      custom_fields_json: JSON.stringify({ Especialidad: "Barba" }),
      catalog_json: JSON.stringify([{ name: "Corte", price: 150, description: "Clásico" }]),
      catalog_source: "manual",
    });
    expect(res.status).toBe(302);
    const bot = await new BotsRepo(db).getById(TEST_BOT_ID);
    expect(bot?.config.country).toBe("México");
    expect(bot?.config.currency).toBe("MXN");
    expect(bot?.config.customFields).toEqual({ Especialidad: "Barba" });
    expect(bot?.config.catalog).toEqual([{ name: "Corte", price: 150, description: "Clásico" }]);
    expect(bot?.config.catalogSource).toBe("manual");
  });

  it("custom_fields_json malformado no tumba el guardado ni borra lo ya guardado", async () => {
    await new BotsRepo(db).mergeConfig(TEST_BOT_ID, { customFields: { Especialidad: "Barba" } });
    const res = await postConfig({ custom_fields_json: "{esto no es json", country: "México" });
    expect(res.status).toBe(302);
    const bot = await new BotsRepo(db).getById(TEST_BOT_ID);
    expect(bot?.config.customFields).toEqual({ Especialidad: "Barba" }); // sobrevive — el patch ignoró esa llave
    expect(bot?.config.country).toBe("México"); // el resto del patch sí se aplicó
  });

  it("catalog_json malformado no tumba el guardado", async () => {
    const res = await postConfig({ catalog_json: "[{roto" });
    expect(res.status).toBe(302);
  });

  it("catalog_source distinto de 'mcp' siempre se normaliza a 'manual'", async () => {
    await postConfig({ catalog_source: "cualquier-cosa" });
    const bot = await new BotsRepo(db).getById(TEST_BOT_ID);
    expect(bot?.config.catalogSource).toBe("manual");
  });

  // Antes hours/location/contactPhone/paymentMethods solo se llenaban una vez
  // desde el skill de onboarding y no había forma de verlos/editarlos/
  // borrarlos desde el panel — quedaban "fantasma" en el prompt sin que el
  // dueño supiera de dónde salían. Ahora son campos explícitos de /admin/config.
  it("guarda horario/ubicación/teléfono/web/métodos de pago en bots.config", async () => {
    const res = await postConfig({
      hours: "Lun-Vie 9am-6pm",
      location: "Av. Reforma 123, CDMX",
      contact_phone: "55 1234 5678",
      website: "https://minegocio.example.com",
      payment_methods: "Efectivo, Tarjeta, Transferencia",
    });
    expect(res.status).toBe(302);
    const bot = await new BotsRepo(db).getById(TEST_BOT_ID);
    expect(bot?.config.hours).toBe("Lun-Vie 9am-6pm");
    expect(bot?.config.location).toBe("Av. Reforma 123, CDMX");
    expect(bot?.config.contactPhone).toBe("55 1234 5678");
    expect(bot?.config.website).toBe("https://minegocio.example.com");
    expect(bot?.config.paymentMethods).toEqual(["Efectivo", "Tarjeta", "Transferencia"]);
  });

  it("dejar un campo básico vacío lo BORRA (antes no había forma de quitar un dato viejo del onboarding)", async () => {
    await new BotsRepo(db).mergeConfig(TEST_BOT_ID, { hours: "dato viejo del onboarding", location: "dirección vieja" });
    const res = await postConfig({ hours: "", location: "" });
    expect(res.status).toBe(302);
    const bot = await new BotsRepo(db).getById(TEST_BOT_ID);
    expect(bot?.config.hours).toBe("");
    expect(bot?.config.location).toBe("");
  });

  it("GET /config renderiza horario/ubicación/teléfono/web/métodos de pago ya guardados, editables", async () => {
    await new BotsRepo(db).mergeConfig(TEST_BOT_ID, {
      hours: "Lun-Vie 9-6",
      location: "CDMX",
      contactPhone: "5512345678",
      website: "https://x.example.com",
      paymentMethods: ["Efectivo", "Tarjeta"],
    });
    const res = await adminApp.request("/config", { headers: AUTH }, env);
    const html = await res.text();
    expect(html).toContain("Lun-Vie 9-6");
    expect(html).toContain("CDMX");
    expect(html).toContain("5512345678");
    expect(html).toContain("https://x.example.com");
    expect(html).toContain("Efectivo, Tarjeta");
  });

  it("GET /config solo ofrece marin/cedar como voz, con etiquetas descriptivas", async () => {
    const res = await adminApp.request("/config", { headers: AUTH }, env);
    const html = await res.text();
    expect(html).toContain('<option value="marin"');
    expect(html).toContain('<option value="cedar"');
    expect(html).toContain("Voz femenina");
    expect(html).toContain("Voz masculina");
    // El resto del catálogo de OpenAI (acento en inglés) ya no se ofrece.
    expect(html).not.toContain('value="alloy"');
    expect(html).not.toContain('value="shimmer"');
  });

  // Bug real reportado: `services` (el campo VIEJO de precios, todavía
  // llenado por el skill de onboarding) nunca tuvo un campo en el panel —
  // quedaba en la vista previa sin ninguna forma de editarlo o borrarlo.
  describe("migración de `services` (legacy) a `catalog`", () => {
    it("si catalog está vacío, precarga el editor con lo que traiga el legacy `services`", async () => {
      await new BotsRepo(db).mergeConfig(TEST_BOT_ID, { services: [{ name: "Corte", price: 250 }] });
      const res = await adminApp.request("/config", { headers: AUTH }, env);
      const html = await res.text();
      expect(html).toContain('value="Corte"');
      expect(html).toContain('value="250"');
    });

    it("si catalog YA tiene datos, no se mezcla con el legacy services", async () => {
      await new BotsRepo(db).mergeConfig(TEST_BOT_ID, {
        catalog: [{ name: "Consultoría", price: 5000 }],
        services: [{ name: "Corte", price: 250 }],
      });
      const res = await adminApp.request("/config", { headers: AUTH }, env);
      const html = await res.text();
      expect(html).toContain('value="Consultoría"');
      expect(html).not.toContain('value="Corte"');
    });

    it("guardar el catálogo (aunque sea vacío) retira `services` para siempre", async () => {
      await new BotsRepo(db).mergeConfig(TEST_BOT_ID, { services: [{ name: "Corte", price: 250 }] });
      const res = await postConfig({ catalog_json: "[]" });
      expect(res.status).toBe(302);
      const bot = await new BotsRepo(db).getById(TEST_BOT_ID);
      expect(bot?.config.services).toBeUndefined();
    });
  });

  it("guarda sales_playbook, voice_name, voice_greeting y agent_mode como settings de texto plano", async () => {
    await postConfig({
      [SETTING_KEYS.salesPlaybook]: "Ofrece siempre agendar al final.",
      [SETTING_KEYS.voiceName]: "shimmer",
      [SETTING_KEYS.voiceGreeting]: "Hola, {{negocio}} al habla{{nombre}}.",
      [SETTING_KEYS.agentMode]: "soporte_tecnico",
    });
    const settings = await new SettingsRepo(db, TEST_BOT_ID).all();
    expect(settings[SETTING_KEYS.salesPlaybook]).toBe("Ofrece siempre agendar al final.");
    expect(settings[SETTING_KEYS.voiceName]).toBe("shimmer");
    expect(settings[SETTING_KEYS.voiceGreeting]).toBe("Hola, {{negocio}} al habla{{nombre}}.");
    expect(settings[SETTING_KEYS.agentMode]).toBe("soporte_tecnico");
  });

  it("GET /config renderiza el <select> de modo operativo con la opción guardada seleccionada", async () => {
    await new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.agentMode, "recepcionista");
    const res = await adminApp.request("/config", { headers: AUTH }, env);
    const html = await res.text();
    expect(html).toContain(`<option value="recepcionista" selected>`);
  });

  it("GET /config renderiza el giro, los campos dinámicos y el catálogo ya guardados", async () => {
    await new BotsRepo(db).updateNiche(TEST_BOT_ID, "barbería");
    await new BotsRepo(db).mergeConfig(TEST_BOT_ID, {
      customFields: { Especialidad: "Fade" },
      catalog: [{ name: "Corte", price: 150 }],
    });
    const res = await adminApp.request("/config", { headers: AUTH }, env);
    const html = await res.text();
    expect(html).toContain("barbería");
    expect(html).toContain("Especialidad");
    expect(html).toContain("Fade");
    expect(html).toContain("Corte");
  });
});
