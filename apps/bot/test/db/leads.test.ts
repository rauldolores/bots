import { describe, it, expect, beforeEach } from "vitest";
import { Db } from "../../src/db/client";
import { createTestDb, TEST_BOT_ID, createSecondTestBot } from "../helpers/pgSetup";
import { LeadsRepo } from "../../src/db/leads";

let db: Db;
let repo: LeadsRepo;

beforeEach(async () => {
  db = await createTestDb();
  repo = new LeadsRepo(db, TEST_BOT_ID);
});

describe("LeadsRepo", () => {
  it("creates a lead and lists it", async () => {
    const id = await repo.create({
      name: "María",
      contact: "+5215512345",
      intent: "Corte+barba 5pm",
      conversationId: null,
      channelUserId: "5512345",
    });
    expect(id).toBeTruthy();
    const list = await repo.list(10);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("María");
    expect(list[0].status).toBe("new");
  });

  it("setStatus updates the row", async () => {
    const id = await repo.create({
      name: "Pedro",
      contact: "pedro@x.com",
      intent: "tinte",
      conversationId: null,
      channelUserId: null,
    });
    await repo.setStatus(id, "sold");
    const list = await repo.list(10);
    expect(list[0].status).toBe("sold");
  });

  it("findLatestByChannelUserId trae el lead más reciente con nombre/contacto de esa cuenta", async () => {
    await repo.create({
      name: "Julián (viejo)",
      contact: "+521111",
      intent: "cotización antigua",
      conversationId: null,
      channelUserId: "wa-123",
    });
    await new Promise((r) => setTimeout(r, 2));
    const latestId = await repo.create({
      name: "Julián Pérez",
      contact: "+521111",
      intent: "cotización nueva",
      conversationId: null,
      channelUserId: "wa-123",
    });
    const found = await repo.findLatestByChannelUserId("wa-123");
    expect(found?.id).toBe(latestId);
    expect(found?.name).toBe("Julián Pérez");
  });

  it("findLatestByChannelUserId no encuentra nada si nunca se capturó nombre/contacto de esa cuenta", async () => {
    expect(await repo.findLatestByChannelUserId("wa-desconocido")).toBeNull();
  });

  it("findLatestByChannelUserId no cruza leads de otro bot", async () => {
    const otherBotId = await createSecondTestBot(db);
    await new LeadsRepo(db, otherBotId).create({
      name: "Cliente ajeno",
      contact: "otro@x.com",
      intent: "otro negocio",
      conversationId: null,
      channelUserId: "wa-compartido",
    });
    expect(await repo.findLatestByChannelUserId("wa-compartido")).toBeNull();
  });

  it("un bot no ve ni puede tocar los leads de otro", async () => {
    const otherBotId = await createSecondTestBot(db);
    const otherRepo = new LeadsRepo(db, otherBotId);
    const theirId = await otherRepo.create({
      name: "Cliente ajeno",
      contact: "otro@x.com",
      intent: "otro negocio",
      conversationId: null,
      channelUserId: null,
    });

    expect(await repo.list(10)).toHaveLength(0);
    await repo.setStatus(theirId, "sold");
    const theirs = await otherRepo.list(10);
    expect(theirs[0].status).toBe("new"); // el setStatus del otro bot no pegó
  });
});
