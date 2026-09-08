import { describe, it, expect, beforeEach } from "vitest";
import { Db } from "../../src/db/client";
import { createTestDb, TEST_BOT_ID, createSecondTestBot } from "../helpers/pgSetup";
import { ConversationsRepo } from "../../src/db/conversations";

let db: Db;
let repo: ConversationsRepo;

beforeEach(async () => {
  db = await createTestDb();
  repo = new ConversationsRepo(db, TEST_BOT_ID);
});

describe("ConversationsRepo", () => {
  it("getOrCreate inserts a row on first call and returns existing on repeat", async () => {
    const conv1 = await repo.getOrCreate("telegram", "user_123", "María");
    const conv2 = await repo.getOrCreate("telegram", "user_123", "María");
    expect(conv1.id).toBe(conv2.id);
    expect(conv1.channel).toBe("telegram");
    expect(conv1.display_name).toBe("María");
  });

  it("setPausedUntil updates the column", async () => {
    const conv = await repo.getOrCreate("telegram", "user_456");
    const until = Date.now() + 3_600_000;
    await repo.setPausedUntil(conv.id, until);
    const fresh = await repo.getById(conv.id);
    expect(fresh?.paused_until).toBe(until);
  });

  it("isPaused returns true when paused_until is in the future", async () => {
    const conv = await repo.getOrCreate("telegram", "user_789");
    await repo.setPausedUntil(conv.id, Date.now() + 60_000);
    expect(await repo.isPaused(conv.id)).toBe(true);
  });

  it("isPaused returns false when paused_until is past", async () => {
    const conv = await repo.getOrCreate("telegram", "user_999");
    await repo.setPausedUntil(conv.id, Date.now() - 60_000);
    expect(await repo.isPaused(conv.id)).toBe(false);
  });

  describe("findByChannelUserId (solo lectura, no crea)", () => {
    it("devuelve null cuando no existe — sin crear una fila", async () => {
      expect(await repo.findByChannelUserId("widget", "nunca-escribio")).toBeNull();
      const rows = await db.all("SELECT id FROM conversations WHERE bot_id = ?", [TEST_BOT_ID]);
      expect(rows).toHaveLength(0);
    });

    it("encuentra la conversación creada por getOrCreate", async () => {
      const conv = await repo.getOrCreate("widget", "visitante_1");
      const found = await repo.findByChannelUserId("widget", "visitante_1");
      expect(found?.id).toBe(conv.id);
    });
  });

  // F2.1: el riesgo dominante del plan de multitenencia — dos bots con un
  // cliente que comparte el mismo id de canal (mismo chat_id, mismo número)
  // NUNCA deben terminar viendo la misma fila.
  describe("aislamiento entre bots", () => {
    it("dos bots con el mismo channel_user_id obtienen conversaciones distintas", async () => {
      const otherBotId = await createSecondTestBot(db);
      const otherRepo = new ConversationsRepo(db, otherBotId);

      const mine = await repo.getOrCreate("telegram", "user_shared", "Cliente A");
      const theirs = await otherRepo.getOrCreate("telegram", "user_shared", "Cliente B");

      expect(mine.id).not.toBe(theirs.id);
      expect(mine.display_name).toBe("Cliente A");
      expect(theirs.display_name).toBe("Cliente B");
    });

    it("getById no ve conversaciones de otro bot", async () => {
      const otherBotId = await createSecondTestBot(db);
      const otherRepo = new ConversationsRepo(db, otherBotId);
      const theirs = await otherRepo.getOrCreate("telegram", "user_other");

      expect(await repo.getById(theirs.id)).toBeNull();
    });

    it("setPausedUntil no puede tocar una conversación de otro bot", async () => {
      const otherBotId = await createSecondTestBot(db);
      const otherRepo = new ConversationsRepo(db, otherBotId);
      const theirs = await otherRepo.getOrCreate("telegram", "user_other");

      await repo.setPausedUntil(theirs.id, Date.now() + 60_000);
      expect(await otherRepo.isPaused(theirs.id)).toBe(false);
    });
  });
});

/**
 * La metadata guarda hoy el hilo de correo al que pertenece la conversación:
 * el asunto y el Message-ID del último entrante. Sin eso, cada respuesta del
 * bot abre un hilo NUEVO en la bandeja del cliente y una conversación de
 * cinco mensajes se ve como cinco correos sueltos.
 */
describe("ConversationsRepo — metadata", () => {
  it("guarda y relee lo que se le puso", async () => {
    const conv = await repo.getOrCreate("email", "ana@x.com");
    await repo.mergeMetadata(conv.id, { emailThread: { subject: "Cotización", messageId: "<a@x>" } });
    expect(await repo.readMetadata(conv.id)).toEqual({
      emailThread: { subject: "Cotización", messageId: "<a@x>" },
    });
  });

  // La columna es de todos, no de un solo caso de uso: pisarla completa haría
  // que quien la use después borre en silencio lo que guardó el anterior.
  it("MEZCLA en vez de pisar lo que ya había", async () => {
    const conv = await repo.getOrCreate("email", "ana2@x.com");
    await repo.mergeMetadata(conv.id, { otraCosa: 1 });
    await repo.mergeMetadata(conv.id, { emailThread: { subject: "Hola" } });
    expect(await repo.readMetadata(conv.id)).toEqual({ otraCosa: 1, emailThread: { subject: "Hola" } });
  });

  it("una conversación sin metadata devuelve un objeto vacío, no null", async () => {
    const conv = await repo.getOrCreate("email", "ana3@x.com");
    expect(await repo.readMetadata(conv.id)).toEqual({});
  });

  // Una fila corrupta no debe tumbar el turno: se pierde lo ilegible y se
  // sigue con lo nuevo, que es lo que sí sabemos que sirve.
  it("metadata corrupta no truena: se descarta y se guarda lo nuevo", async () => {
    const conv = await repo.getOrCreate("email", "ana4@x.com");
    await db.run("UPDATE conversations SET metadata = ? WHERE id = ?", ["{no es json", conv.id]);
    expect(await repo.readMetadata(conv.id)).toEqual({});
    await repo.mergeMetadata(conv.id, { emailThread: { subject: "Hola" } });
    expect(await repo.readMetadata(conv.id)).toEqual({ emailThread: { subject: "Hola" } });
  });

  it("no toca la conversación de otro bot", async () => {
    const conv = await repo.getOrCreate("email", "ana5@x.com");
    const otroBot = await createSecondTestBot(db);
    await new ConversationsRepo(db, otroBot).mergeMetadata(conv.id, { emailThread: { subject: "ajeno" } });
    expect(await repo.readMetadata(conv.id)).toEqual({});
  });
});
