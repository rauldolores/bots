import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/pgSetup";
import { TicketsRepo } from "../../src/db/tickets";

let repo: TicketsRepo;

beforeEach(async () => {
  const d1 = await createTestDb();
  repo = new TicketsRepo(d1);
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
});
