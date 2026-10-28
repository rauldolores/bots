/**
 * Salud del bot (la píldora de la cabecera) contra la base real: cada señal
 * por su cuenta y el estado que resulta.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { BotChannelsRepo } from "../../src/db/botChannels";
import { BotConnectorsRepo } from "../../src/db/botConnectors";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { saludDelBot, COLA_ATORADA_MS } from "../../src/estado/salud";
import type { Env } from "../../src/env";

let db: Db;
let env: Env;
const NOW = Date.now();

beforeEach(async () => {
  db = await createTestDb();
  env = { DB: db.driver, DASHBOARD_BASE_URL: "https://panel.test" } as unknown as Env;
  // Un canal conectado: si no, sale el aviso "sin canales" en todas.
  await new BotChannelsRepo(db).upsert({ botId: TEST_BOT_ID, channel: "telegram", externalId: "x" });
});

const titulos = async () => (await saludDelBot(env, TEST_BOT_ID, NOW)).hallazgos.map((h) => h.titulo);

describe("saludDelBot", () => {
  it("sin nada raro: en línea y sin hallazgos", async () => {
    expect(await saludDelBot(env, TEST_BOT_ID, NOW)).toEqual({ estado: "EN_LINEA", hallazgos: [] });
  });

  it("en pausa (el ajuste de Flujo) → EN_PAUSA, con el enlace para activarlo", async () => {
    await new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.botPaused, "1");
    const s = await saludDelBot(env, TEST_BOT_ID, NOW);
    expect(s.estado).toBe("EN_PAUSA");
    expect(s.hallazgos[0]).toMatchObject({ nivel: "pausa", href: "/admin/agente" });
  });

  it("3 respuestas «Algo falló» en 30 min → PROBLEMAS; 2 no alcanzan", async () => {
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("telegram", "u1");
    const m = new MessagesRepo(db, TEST_BOT_ID);
    await m.append(conv.id, "assistant", "Algo falló de mi lado…", { createdAt: NOW - 60_000 });
    await m.append(conv.id, "assistant", "Algo falló de mi lado…", { createdAt: NOW - 50_000 });
    expect((await saludDelBot(env, TEST_BOT_ID, NOW)).estado).toBe("EN_LINEA");
    await m.append(conv.id, "assistant", "Algo falló de mi lado…", { createdAt: NOW - 40_000 });
    const s = await saludDelBot(env, TEST_BOT_ID, NOW);
    expect(s.estado).toBe("PROBLEMAS");
    expect(s.hallazgos[0].texto).toContain("3 respuestas fallaron");
  });

  it("un mensaje que lleva más de 3 min esperando turno → PROBLEMAS; en pausa no cuenta", async () => {
    await db.run("INSERT INTO agent_jobs (conversation_key, run_after) VALUES (?, ?)", [`${TEST_BOT_ID}:telegram:u1`, NOW - COLA_ATORADA_MS - 1000]);
    await db.run("INSERT INTO agent_jobs (conversation_key, run_after) VALUES (?, ?)", [`otro-bot:telegram:u1`, NOW - COLA_ATORADA_MS - 1000]);
    await db.run("INSERT INTO agent_jobs (conversation_key, run_after) VALUES (?, ?)", [`${TEST_BOT_ID}:telegram:u2`, NOW - 10_000]);
    const s = await saludDelBot(env, TEST_BOT_ID, NOW);
    expect(s.estado).toBe("PROBLEMAS");
    expect(s.hallazgos[0].texto).toContain("1 conversación lleva");

    await new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.botPaused, "1");
    expect(await titulos()).toEqual(["Tu bot está en pausa"]);
  });

  it("un conector MCP que falló y no se ha renovado → PROBLEMAS; renovado después ya no", async () => {
    const repo = new BotConnectorsRepo(db);
    await repo.upsert({ botId: TEST_BOT_ID, category: "mcp", provider: "mcp:crm", name: "Mi CRM", config: { mcpLastError: "401", mcpLastErrorAt: String(NOW - 1000) } as never });
    expect(await titulos()).toEqual(["Mi CRM perdió la conexión"]);
    await repo.mergeConfig(TEST_BOT_ID, "mcp:crm", { oauthRefreshedAt: String(NOW) } as never);
    expect(await titulos()).toEqual([]);
  });

  it("conversaciones sin atender por el plan → PROBLEMAS, con enlace a Plan", async () => {
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("telegram", "u3");
    await db.run("UPDATE conversations SET sin_cupo_at = ? WHERE id = ?", [NOW, conv.id]);
    const s = await saludDelBot(env, TEST_BOT_ID, NOW);
    expect(s.estado).toBe("PROBLEMAS");
    expect(s.hallazgos[0].href).toBe("/admin/plan");
  });

  it("sin ningún canal conectado → AVISO (sigue en línea, pero nadie le escribe)", async () => {
    await new BotChannelsRepo(db).disable(TEST_BOT_ID, "telegram");
    const s = await saludDelBot(env, TEST_BOT_ID, NOW);
    expect(s.estado).toBe("AVISO");
    expect(s.hallazgos[0].titulo).toBe("Tu bot no tiene canales conectados");
  });

  it("lo grave va primero: problema, luego pausa, luego aviso", async () => {
    await new BotChannelsRepo(db).disable(TEST_BOT_ID, "telegram");
    await new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.botPaused, "1");
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("telegram", "u4");
    await db.run("UPDATE conversations SET sin_cupo_at = ? WHERE id = ?", [NOW, conv.id]);
    const s = await saludDelBot(env, TEST_BOT_ID, NOW);
    expect(s.estado).toBe("PROBLEMAS");
    expect(s.hallazgos.map((h) => h.nivel)).toEqual(["problema", "pausa", "aviso"]);
  });
});
