import { describe, it, expect, beforeEach } from "vitest";
import { Db } from "../../src/db/client";
import { createTestDb, TEST_BOT_ID, createSecondTestBot } from "../helpers/pgSetup";
import { AppointmentsRepo } from "../../src/db/appointments";

let db: Db;
let repo: AppointmentsRepo;

const NOW = Date.parse("2026-06-01T00:00:00Z");

beforeEach(async () => {
  db = await createTestDb();
  repo = new AppointmentsRepo(db, TEST_BOT_ID);
});

describe("AppointmentsRepo", () => {
  it("create + listUpcoming trae la cita", async () => {
    await repo.create({ conversationId: null, customerName: "Ana", customerContact: "ana@x.com", startsAt: NOW + 86_400_000 });
    const list = await repo.listUpcoming(10, NOW);
    expect(list).toHaveLength(1);
    expect(list[0].customer_name).toBe("Ana");
    expect(list[0].status).toBe("scheduled");
  });

  it("no trae citas pasadas", async () => {
    await repo.create({ conversationId: null, customerName: "Vieja", startsAt: NOW - 86_400_000 });
    expect(await repo.listUpcoming(10, NOW)).toHaveLength(0);
  });

  it("ordena por fecha ascendente", async () => {
    await repo.create({ conversationId: null, customerName: "Después", startsAt: NOW + 2 * 86_400_000 });
    await repo.create({ conversationId: null, customerName: "Antes", startsAt: NOW + 86_400_000 });
    const list = await repo.listUpcoming(10, NOW);
    expect(list.map((a) => a.customer_name)).toEqual(["Antes", "Después"]);
  });

  it("cancel saca la cita de listUpcoming (pero no la borra)", async () => {
    const id = await repo.create({ conversationId: null, customerName: "Ana", startsAt: NOW + 86_400_000 });
    await repo.cancel(id);
    expect(await repo.listUpcoming(10, NOW)).toHaveLength(0);
  });

  it("guarda external_ref cuando la reserva se confirmó en un conector", async () => {
    const id = await repo.create({ conversationId: null, customerName: "Ana", startsAt: NOW + 86_400_000, externalRef: "cal-999" });
    const [row] = await repo.listUpcoming(10, NOW);
    expect(row.id).toBe(id);
    expect(row.external_ref).toBe("cal-999");
  });

  it("no ve las citas de otro bot", async () => {
    const otherBotId = await createSecondTestBot(db);
    await new AppointmentsRepo(db, otherBotId).create({ conversationId: null, customerName: "Otro bot", startsAt: NOW + 86_400_000 });
    expect(await repo.listUpcoming(10, NOW)).toHaveLength(0);
  });
});
