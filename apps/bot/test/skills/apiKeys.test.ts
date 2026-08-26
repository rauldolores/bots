/**
 * Llaves de API: generación, hash, y el chequeo de tres pasos de la auth
 * (existe → habilitada → el canal 'api' está prendido).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, createSecondTestBot, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { BotApiKeysRepo, hashApiKey, prefixOf, generateApiKey } from "../../src/db/apiKeys";
import { BotChannelsRepo } from "../../src/db/botChannels";
import { resolveApiCaller, bearerFrom } from "../../src/skills/auth";

let db: Db;
let repo: BotApiKeysRepo;

beforeEach(async () => {
  db = await createTestDb();
  repo = new BotApiKeysRepo(db);
  // El canal 'api' es el interruptor general del dueño.
  await new BotChannelsRepo(db).upsert({ botId: TEST_BOT_ID, channel: "api", config: {} });
});

describe("generación de llaves", () => {
  it("todas tienen el MISMO largo — tokensMatch sale temprano si difieren y filtraría información", async () => {
    const a = await generateApiKey();
    const b = await generateApiKey();
    expect(a.plaintext.length).toBe(b.plaintext.length);
    expect(a.plaintext).not.toBe(b.plaintext);
  });

  it("el prefijo de la llave se puede extraer de vuelta", async () => {
    const { plaintext, prefix } = await generateApiKey();
    expect(prefixOf(plaintext)).toBe(prefix);
  });

  it("una llave con forma inválida no da prefijo", () => {
    expect(prefixOf("no-es-una-llave")).toBeNull();
    expect(prefixOf("")).toBeNull();
  });

  it("nunca se guarda el texto de la llave, solo su hash", async () => {
    const { plaintext } = await repo.create(TEST_BOT_ID, "integración de prueba");
    const rows = await db.all<{ key_hash: string }>("SELECT key_hash FROM bot_api_keys");
    expect(rows).toHaveLength(1);
    expect(rows[0].key_hash).not.toContain(plaintext);
    expect(rows[0].key_hash).toBe(await hashApiKey(plaintext));
  });
});

describe("resolveApiCaller", () => {
  it("una llave válida resuelve a su bot", async () => {
    const { plaintext } = await repo.create(TEST_BOT_ID, "prod");
    const caller = await resolveApiCaller(db, plaintext);
    expect(caller?.botId).toBe(TEST_BOT_ID);
  });

  it("rechaza una llave inventada, vacía o nula", async () => {
    await repo.create(TEST_BOT_ID, "prod");
    expect(await resolveApiCaller(db, "na_deadbeef_" + "0".repeat(48))).toBeNull();
    expect(await resolveApiCaller(db, "")).toBeNull();
    expect(await resolveApiCaller(db, null)).toBeNull();
  });

  it("una llave revocada deja de servir", async () => {
    const { id, plaintext } = await repo.create(TEST_BOT_ID, "prod");
    await repo.setEnabled(id, TEST_BOT_ID, false);
    expect(await resolveApiCaller(db, plaintext)).toBeNull();
  });

  it("apagar el canal 'api' desactiva TODAS las llaves de golpe", async () => {
    const { plaintext } = await repo.create(TEST_BOT_ID, "prod");
    expect(await resolveApiCaller(db, plaintext)).not.toBeNull();

    await new BotChannelsRepo(db).disable(TEST_BOT_ID, "api");
    expect(await resolveApiCaller(db, plaintext)).toBeNull();
  });

  it("la llave de un bot no sirve para otro", async () => {
    const otherBotId = await createSecondTestBot(db);
    await new BotChannelsRepo(db).upsert({ botId: otherBotId, channel: "api", config: {} });
    const { plaintext } = await repo.create(otherBotId, "del otro bot");

    const caller = await resolveApiCaller(db, plaintext);
    expect(caller?.botId).toBe(otherBotId);
    expect(caller?.botId).not.toBe(TEST_BOT_ID);
  });
});

describe("bearerFrom", () => {
  it("saca el token del header y tolera mayúsculas y espacios", () => {
    const req = (h: string) => new Request("https://x/v1/skills", { headers: { Authorization: h } });
    expect(bearerFrom(req("Bearer abc123"))).toBe("abc123");
    expect(bearerFrom(req("bearer  abc123 "))).toBe("abc123");
    expect(bearerFrom(new Request("https://x/v1/skills"))).toBeNull();
    expect(bearerFrom(req("Basic abc123"))).toBeNull();
  });
});
