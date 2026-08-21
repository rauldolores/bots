import { describe, it, expect, beforeEach } from "vitest";
import { Db } from "../../src/db/client";
import { createTestDb, TEST_BOT_ID, createSecondTestBot } from "../helpers/pgSetup";
import { BotConnectorsRepo } from "../../src/db/botConnectors";

let db: Db;
let repo: BotConnectorsRepo;

beforeEach(async () => {
  db = await createTestDb();
  repo = new BotConnectorsRepo(db);
});

describe("BotConnectorsRepo", () => {
  it("upsert luego getByBotAndProvider devuelve la fila", async () => {
    await repo.upsert({
      botId: TEST_BOT_ID,
      category: "crm",
      provider: "hubspot",
      secretRef: "11111111-1111-1111-1111-111111111111",
    });
    const row = await repo.getByBotAndProvider(TEST_BOT_ID, "hubspot");
    expect(row?.category).toBe("crm");
    expect(row?.secret_ref).toBe("11111111-1111-1111-1111-111111111111");
    expect(row?.enabled).toBe(true);
  });

  it("un segundo upsert al mismo (bot, provider) actualiza en vez de duplicar", async () => {
    await repo.upsert({ botId: TEST_BOT_ID, category: "crm", provider: "hubspot", secretRef: "11111111-1111-1111-1111-111111111111" });
    await repo.upsert({ botId: TEST_BOT_ID, category: "crm", provider: "hubspot", secretRef: "22222222-2222-2222-2222-222222222222" });
    const row = await repo.getByBotAndProvider(TEST_BOT_ID, "hubspot");
    expect(row?.secret_ref).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("getByBotAndProvider no ve el conector de otro bot", async () => {
    const otherBotId = await createSecondTestBot(db);
    await repo.upsert({ botId: otherBotId, category: "crm", provider: "hubspot" });
    expect(await repo.getByBotAndProvider(TEST_BOT_ID, "hubspot")).toBeNull();
  });

  it("disable apaga el conector sin borrar la fila", async () => {
    await repo.upsert({ botId: TEST_BOT_ID, category: "crm", provider: "hubspot" });
    await repo.disable(TEST_BOT_ID, "hubspot");
    expect(await repo.getByBotAndProvider(TEST_BOT_ID, "hubspot")).toBeNull();
  });

  it("getActiveByCategory trae el conector activo de esa categoría", async () => {
    await repo.upsert({ botId: TEST_BOT_ID, category: "crm", provider: "hubspot" });
    const row = await repo.getActiveByCategory(TEST_BOT_ID, "crm");
    expect(row?.provider).toBe("hubspot");
    expect(await repo.getActiveByCategory(TEST_BOT_ID, "tickets")).toBeNull();
  });

  it("listByBot lista todos los conectores del bot, sin importar categoría", async () => {
    await repo.upsert({ botId: TEST_BOT_ID, category: "crm", provider: "hubspot" });
    await repo.upsert({ botId: TEST_BOT_ID, category: "tickets", provider: "zendesk" });
    const list = await repo.listByBot(TEST_BOT_ID);
    expect(list.map((r) => r.provider).sort()).toEqual(["hubspot", "zendesk"]);
  });

  describe("config (subdominio, dominio de empresa… nunca el API key)", () => {
    it("guarda y lee config no-secreta", async () => {
      await repo.upsert({
        botId: TEST_BOT_ID,
        category: "tickets",
        provider: "zendesk",
        secretRef: "11111111-1111-1111-1111-111111111111",
        config: { subdomain: "miempresa", email: "yo@empresa.com" },
      });
      const row = await repo.getByBotAndProvider(TEST_BOT_ID, "zendesk");
      expect(row?.config).toEqual({ subdomain: "miempresa", email: "yo@empresa.com" });
    });

    it("un upsert sin config conserva la que ya había (no la vacía)", async () => {
      await repo.upsert({ botId: TEST_BOT_ID, category: "crm", provider: "pipedrive", config: { domain: "acme" } });
      await repo.upsert({ botId: TEST_BOT_ID, category: "crm", provider: "pipedrive", secretRef: "22222222-2222-2222-2222-222222222222" });
      const row = await repo.getByBotAndProvider(TEST_BOT_ID, "pipedrive");
      expect(row?.config).toEqual({ domain: "acme" });
      expect(row?.secret_ref).toBe("22222222-2222-2222-2222-222222222222");
    });

    it("sin conector conectado, config es un objeto vacío (nunca null)", async () => {
      await repo.upsert({ botId: TEST_BOT_ID, category: "crm", provider: "hubspot" });
      const row = await repo.getByBotAndProvider(TEST_BOT_ID, "hubspot");
      expect(row?.config).toEqual({});
    });
  });
});
