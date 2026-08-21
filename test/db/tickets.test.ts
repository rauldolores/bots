import { describe, it, expect, beforeEach } from "vitest";
import { Db } from "../../src/db/client";
import { createTestDb, TEST_BOT_ID, createSecondTestBot } from "../helpers/pgSetup";
import { TicketsRepo } from "../../src/db/tickets";

let db: Db;
let repo: TicketsRepo;

beforeEach(async () => {
  db = await createTestDb();
  repo = new TicketsRepo(db, TEST_BOT_ID);
});

describe("TicketsRepo", () => {
  it("creates open ticket", async () => {
    const id = await repo.create({
      conversationId: null,
      category: "product",
      summary: "Pregunta sobre shampoo",
      transcript: "user: hola\nbot: ...",
    });
    const ticket = await repo.getById(id);
    expect(ticket?.status).toBe("open");
    expect(ticket?.summary).toBe("Pregunta sobre shampoo");
  });

  it("resolve sets status + resolved_at", async () => {
    const id = await repo.create({
      conversationId: null,
      category: "other",
      summary: "x",
      transcript: "",
    });
    await repo.resolve(id, "agente@ejemplo.com");
    const ticket = await repo.getById(id);
    expect(ticket?.status).toBe("resolved");
    expect(ticket?.resolved_at).toBeTruthy();
    expect(ticket?.resolved_by).toBe("agente@ejemplo.com");
  });

  it("listOpen returns only open tickets", async () => {
    await repo.create({ conversationId: null, category: "x", summary: "a", transcript: "" });
    const idResolved = await repo.create({ conversationId: null, category: "x", summary: "b", transcript: "" });
    await repo.resolve(idResolved, "agente@x.com");
    const list = await repo.listOpen();
    expect(list).toHaveLength(1);
    expect(list[0].summary).toBe("a");
  });

  it("prioridad default 'normal' cuando no se especifica", async () => {
    const id = await repo.create({ conversationId: null, category: "x", summary: "a", transcript: "" });
    expect((await repo.getById(id))?.priority).toBe("normal");
  });

  it("crea con prioridad y datos de quien pide", async () => {
    const id = await repo.create({
      conversationId: null,
      category: "billing",
      summary: "No puede pagar",
      transcript: "Cliente: no puedo pagar\nBot: ...",
      priority: "urgent",
      requesterName: "Ana",
      requesterContact: "ana@x.com",
    });
    const ticket = await repo.getById(id);
    expect(ticket?.priority).toBe("urgent");
    expect(ticket?.requester_name).toBe("Ana");
    expect(ticket?.requester_contact).toBe("ana@x.com");
  });

  it("setPriority cambia la prioridad de un ticket ya creado", async () => {
    const id = await repo.create({ conversationId: null, category: "x", summary: "a", transcript: "" });
    await repo.setPriority(id, "high");
    expect((await repo.getById(id))?.priority).toBe("high");
  });

  it("setPriority no toca el ticket de otro bot", async () => {
    const otherBotId = await createSecondTestBot(db);
    const otherRepo = new TicketsRepo(db, otherBotId);
    const theirId = await otherRepo.create({ conversationId: null, category: "x", summary: "ajeno", transcript: "" });
    await repo.setPriority(theirId, "urgent");
    expect((await otherRepo.getById(theirId))?.priority).toBe("normal");
  });

  it("un bot no ve ni puede resolver los tickets de otro", async () => {
    const otherBotId = await createSecondTestBot(db);
    const otherRepo = new TicketsRepo(db, otherBotId);
    const theirId = await otherRepo.create({
      conversationId: null,
      category: "x",
      summary: "ajeno",
      transcript: "",
    });

    expect(await repo.getById(theirId)).toBeNull();
    expect(await repo.listOpen()).toHaveLength(0);
    await repo.resolve(theirId, "intruso@x.com");
    const theirs = await otherRepo.getById(theirId);
    expect(theirs?.status).toBe("open"); // el resolve del otro bot no pegó
  });
});
