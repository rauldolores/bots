import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "./helpers/pgSetup";
import { SettingsRepo, SETTING_KEYS } from "../src/db/settings";
import { BotsRepo } from "../src/db/bots";
import { BotConnectorsRepo } from "../src/db/botConnectors";
import { resolveAgentConfig } from "../src/settings-loader";

const TOOLS = ["searchKb", "handoffHuman"];

let env: any;
let repo: SettingsRepo;
let db: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  db = await createTestDb();
  env = {
    DB: db.driver,
    BOT_NAME: "Asistente",
    BUSINESS_NAME: "Test Business",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "12",
  };
  repo = new SettingsRepo(db, TEST_BOT_ID);
});

describe("resolveAgentConfig", () => {
  it("uses env/defaults when settings are empty", async () => {
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.bufferMs).toBe(12_000); // from BUFFER_SECONDS
    expect(cfg.maxChunks).toBe(3);
    expect(cfg.interChunkDelayMs).toBe(1000);
    expect(cfg.modelOverride).toBe("auto");
    expect(cfg.botPaused).toBe(false);
    expect(cfg.systemPrompt).toContain("Test Bot"); // bots.name (F3, pgSetup TEST_BOT_ID)
    expect(cfg.systemPrompt).toContain("<role>");
    expect(cfg.systemPrompt).not.toContain("{{");
  });

  it("system_prompt_override wins over the generated prompt", async () => {
    await repo.set(SETTING_KEYS.systemPromptOverride, "MI PROMPT CUSTOM");
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.systemPrompt).toBe("MI PROMPT CUSTOM");
  });

  it("applies bot_name, tone and escalation_keywords into the generated prompt", async () => {
    await repo.set(SETTING_KEYS.botName, "Pelusa");
    await repo.set(SETTING_KEYS.tone, "divertido y relajado");
    await repo.set(SETTING_KEYS.escalationKeywords, "reembolso, gerente");
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.systemPrompt).toContain("Pelusa");
    expect(cfg.systemPrompt).toContain("divertido y relajado");
    expect(cfg.systemPrompt).toContain("reembolso, gerente");
  });

  it("uses business_context override when present", async () => {
    await repo.set(SETTING_KEYS.businessContext, "MI CONTEXTO DE NEGOCIO");
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.systemPrompt).toContain("MI CONTEXTO DE NEGOCIO");
  });

  it("buffer_seconds overrides env and enforces a 1000ms floor", async () => {
    await repo.set(SETTING_KEYS.bufferSeconds, "5");
    let cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.bufferMs).toBe(5000);

    await repo.set(SETTING_KEYS.bufferSeconds, "0");
    cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.bufferMs).toBe(1000);
  });

  it("clamps max_chunks to 1..5", async () => {
    await repo.set(SETTING_KEYS.maxChunks, "99");
    expect((await resolveAgentConfig(env, TOOLS)).maxChunks).toBe(5);
    await repo.set(SETTING_KEYS.maxChunks, "0");
    expect((await resolveAgentConfig(env, TOOLS)).maxChunks).toBe(1);
    await repo.set(SETTING_KEYS.maxChunks, "2");
    expect((await resolveAgentConfig(env, TOOLS)).maxChunks).toBe(2);
  });

  it("clamps inter_chunk_delay_ms to 0..5000", async () => {
    await repo.set(SETTING_KEYS.interChunkDelayMs, "999999");
    expect((await resolveAgentConfig(env, TOOLS)).interChunkDelayMs).toBe(5000);
    await repo.set(SETTING_KEYS.interChunkDelayMs, "-50");
    expect((await resolveAgentConfig(env, TOOLS)).interChunkDelayMs).toBe(0);
  });

  it("parses model_override and falls back to auto for garbage", async () => {
    await repo.set(SETTING_KEYS.modelOverride, "haiku");
    expect((await resolveAgentConfig(env, TOOLS)).modelOverride).toBe("haiku");
    await repo.set(SETTING_KEYS.modelOverride, "sonnet");
    expect((await resolveAgentConfig(env, TOOLS)).modelOverride).toBe("sonnet");
    await repo.set(SETTING_KEYS.modelOverride, "nonsense");
    expect((await resolveAgentConfig(env, TOOLS)).modelOverride).toBe("auto");
  });

  it("reads bot_paused as a boolean (1 => true, anything else => false)", async () => {
    await repo.set(SETTING_KEYS.botPaused, "1");
    expect((await resolveAgentConfig(env, TOOLS)).botPaused).toBe(true);
    await repo.set(SETTING_KEYS.botPaused, "0");
    expect((await resolveAgentConfig(env, TOOLS)).botPaused).toBe(false);
  });
});

describe("resolveAgentConfig — disabled_tools", () => {
  it("filters enabledToolNames and the prompt's tool list", async () => {
    await repo.set(SETTING_KEYS.disabledTools, "handoffHuman");
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.enabledToolNames).toEqual(["searchKb"]);
    expect(cfg.systemPrompt).toContain("- searchKb");
    expect(cfg.systemPrompt).not.toContain("- handoffHuman");
  });

  it("keeps everything enabled when the setting is absent or empty", async () => {
    let cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.enabledToolNames).toEqual(TOOLS);

    await repo.set(SETTING_KEYS.disabledTools, "  ");
    cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.enabledToolNames).toEqual(TOOLS);
  });

  it("ignores unknown names in the setting", async () => {
    await repo.set(SETTING_KEYS.disabledTools, "noExiste, searchKb");
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.enabledToolNames).toEqual(["handoffHuman"]);
  });
});

describe("resolveAgentConfig — temperature", () => {
  it("is undefined when unset (provider default)", async () => {
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.temperature).toBeUndefined();
  });

  it("parses and clamps the stored value to [0, 1]", async () => {
    await repo.set(SETTING_KEYS.temperature, "0.3");
    expect((await resolveAgentConfig(env, TOOLS)).temperature).toBe(0.3);

    await repo.set(SETTING_KEYS.temperature, "7");
    expect((await resolveAgentConfig(env, TOOLS)).temperature).toBe(1);
  });

  it("ignores garbage values", async () => {
    await repo.set(SETTING_KEYS.temperature, "caliente");
    expect((await resolveAgentConfig(env, TOOLS)).temperature).toBeUndefined();
  });
});

describe("resolveAgentConfig — learned lessons (flywheel)", () => {
  it("injects lessons into the generated prompt", async () => {
    await repo.set(SETTING_KEYS.learnedLessons, JSON.stringify(["Confirma el pago antes de prometer acceso."]));
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.systemPrompt).toContain("<lecciones_aprendidas>");
    expect(cfg.systemPrompt).toContain("Confirma el pago antes de prometer acceso.");
  });

  it("omits the block without lessons and tolerates malformed JSON", async () => {
    let cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.systemPrompt).not.toContain("<lecciones_aprendidas>");

    await repo.set(SETTING_KEYS.learnedLessons, "{no es json");
    cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.systemPrompt).not.toContain("<lecciones_aprendidas>");
  });
});

describe("resolveAgentConfig — sales_playbook (llena {{NICHO_PLAYBOOK}})", () => {
  it("el playbook del dueño llega al prompt generado", async () => {
    await repo.set(SETTING_KEYS.salesPlaybook, "Ofrece siempre la promoción de temporada.");
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.systemPrompt).toContain("Ofrece siempre la promoción de temporada.");
  });

  it("sin playbook del dueño, no aparece nada raro (niche 'generico' tiene playbook vacío)", async () => {
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.systemPrompt).not.toContain("undefined");
  });
});

describe("resolveAgentConfig — voice_name", () => {
  it("undefined cuando no está configurado", async () => {
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.voiceName).toBeUndefined();
  });

  it("se lee tal cual del setting", async () => {
    await repo.set(SETTING_KEYS.voiceName, "shimmer");
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.voiceName).toBe("shimmer");
  });
});

describe("resolveAgentConfig — voice_greeting", () => {
  it("undefined cuando no está configurado — el saludo cae al default (voiceGreeting.ts)", async () => {
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.voiceGreeting).toBeUndefined();
  });

  it("se lee tal cual del setting", async () => {
    await repo.set(SETTING_KEYS.voiceGreeting, "Hola, {{negocio}} al habla{{nombre}}.");
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.voiceGreeting).toBe("Hola, {{negocio}} al habla{{nombre}}.");
  });
});

describe("resolveAgentConfig — agent_mode (modo operativo, agentModes.ts)", () => {
  it("sin setting: el prompt final no trae <modo_operativo>", async () => {
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.systemPrompt).not.toContain("<modo_operativo>");
  });

  it("con un slug válido del catálogo: el prompt final trae el perfil completo del modo", async () => {
    await repo.set(SETTING_KEYS.agentMode, "vendedor");
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.systemPrompt).toContain("<modo_operativo>");
    expect(cfg.systemPrompt).toContain("Rol: Vendedor");
    expect(cfg.systemPrompt).toContain("Escalamiento: Ejecutivo humano");
  });

  it("slug inválido/de un catálogo viejo: se ignora, nunca un <modo_operativo> a medias", async () => {
    await repo.set(SETTING_KEYS.agentMode, "modo-que-ya-no-existe");
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.systemPrompt).not.toContain("<modo_operativo>");
  });
});

describe("resolveAgentConfig — país/moneda (<contexto_regional>)", () => {
  it("con ambos capturados, aparecen en el prompt", async () => {
    await new BotsRepo(db).mergeConfig(TEST_BOT_ID, { country: "México", currency: "MXN" });
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.systemPrompt).toContain("<contexto_regional>");
    expect(cfg.systemPrompt).toContain("México");
    expect(cfg.systemPrompt).toContain("MXN");
  });

  it("sin ninguno de los dos, se omite el bloque completo", async () => {
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.systemPrompt).not.toContain("<contexto_regional>");
  });
});

describe("resolveAgentConfig — catálogo vía MCP", () => {
  it("catalogSource:'mcp' + un conector MCP habilitado produce <catalogo_mcp>", async () => {
    await new BotsRepo(db).mergeConfig(TEST_BOT_ID, { catalogSource: "mcp" });
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "mcp-ventas",
      name: "Sistema de ventas",
      config: { url: "https://mcp.example.com/ventas" },
    });
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.systemPrompt).toContain("<catalogo_mcp>");
    expect(cfg.systemPrompt).toContain("Sistema de ventas");
  });

  it("catalogSource:'mcp' sin ningún conector conectado no produce la nota (nada de qué hablar)", async () => {
    await new BotsRepo(db).mergeConfig(TEST_BOT_ID, { catalogSource: "mcp" });
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.systemPrompt).not.toContain("<catalogo_mcp>");
  });

  it("catalogSource:'manual' (o ausente) nunca produce la nota, aunque haya un MCP conectado", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "mcp-otro",
      name: "Otro sistema",
      config: { url: "https://mcp.example.com/otro" },
    });
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.systemPrompt).not.toContain("<catalogo_mcp>");
  });
});

describe("resolveAgentConfig — <herramientas_mcp> (bug real: captureLead/handoffHuman solo empujan a hubspot/pipedrive/zendesk/jira, un MCP genérico queda invisible sin este aviso)", () => {
  it("con CUALQUIER MCP conectado (sin importar catalogSource): avisa que las tools internas no lo registran solas ahí", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "mi-crm",
      name: "Mi CRM",
      config: { url: "https://mcp.example.com/crm" },
    });
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.systemPrompt).toContain("<herramientas_mcp>");
    expect(cfg.systemPrompt).toContain("Mi CRM");
    expect(cfg.systemPrompt).toContain("captureLead");
  });

  it("sin ningún MCP conectado: no aparece la nota", async () => {
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.systemPrompt).not.toContain("<herramientas_mcp>");
  });

  it("convive con <catalogo_mcp> cuando ambas aplican (mismo o distinto conector)", async () => {
    await new BotsRepo(db).mergeConfig(TEST_BOT_ID, { catalogSource: "mcp" });
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "mcp-ventas2",
      name: "Sistema de ventas",
      config: { url: "https://mcp.example.com/ventas2" },
    });
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.systemPrompt).toContain("<catalogo_mcp>");
    expect(cfg.systemPrompt).toContain("<herramientas_mcp>");
  });
});
