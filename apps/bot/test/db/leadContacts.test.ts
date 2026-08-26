/**
 * lead_contacts y opt_outs contra Postgres real (un driver simulado no prueba
 * el SQL — ver CLAUDE.md).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, createSecondTestBot, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { LeadsRepo } from "../../src/db/leads";
import { LeadContactsRepo } from "../../src/db/leadContacts";
import { OptOutsRepo } from "../../src/db/optOuts";
import { phoneVariants } from "../../src/contacts/normalize";

let db: Db;
let leadId: string;
let contacts: LeadContactsRepo;
let optOuts: OptOutsRepo;

beforeEach(async () => {
  db = await createTestDb();
  leadId = await new LeadsRepo(db, TEST_BOT_ID).create({
    conversationId: null,
    name: "Ana",
    contact: "55 1234 5678",
    channelUserId: null,
    intent: "quiere el curso",
  });
  contacts = new LeadContactsRepo(db, TEST_BOT_ID);
  optOuts = new OptOutsRepo(db, TEST_BOT_ID);
});

describe("LeadContactsRepo", () => {
  it("guarda un contacto tipado y lo devuelve", async () => {
    await contacts.add({
      leadId,
      kind: "phone",
      addressRaw: "55 1234 5678",
      addressNorm: "+525512345678",
      consent: "inbound",
      verified: true,
    });
    const lista = await contacts.listByLead(leadId);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({
      kind: "phone",
      address_norm: "+525512345678",
      consent: "inbound",
      verified: true,
    });
  });

  it("capturar el mismo contacto dos veces no duplica", async () => {
    const entrada = {
      leadId,
      kind: "phone" as const,
      addressRaw: "55 1234 5678",
      addressNorm: "+525512345678",
    };
    await contacts.add(entrada);
    await contacts.add(entrada);
    expect(await contacts.listByLead(leadId)).toHaveLength(1);
  });

  it("un lead puede tener teléfono Y correo Y un canal", async () => {
    await contacts.add({ leadId, kind: "phone", addressRaw: "x", addressNorm: "+525512345678" });
    await contacts.add({ leadId, kind: "email", addressRaw: "x", addressNorm: "ana@x.com" });
    await contacts.add({
      leadId,
      kind: "channel",
      channel: "telegram",
      addressRaw: "418122771",
      addressNorm: "telegram:418122771",
    });
    expect(await contacts.listByLead(leadId)).toHaveLength(3);
  });

  it("findByAddress cruza el teléfono aunque venga en otra de sus formas", async () => {
    await contacts.add({
      leadId,
      kind: "phone",
      addressRaw: "+5215512345678",
      addressNorm: "+525512345678",
    });
    // Entra el mismo número tal como lo mandaría WhatsApp Cloud API.
    const hallados = await contacts.findByAddress(phoneVariants("+5215512345678"));
    expect(hallados).toHaveLength(1);
    expect(hallados[0].lead_id).toBe(leadId);
  });

  it("no ve los contactos de otro bot", async () => {
    const otroBot = await createSecondTestBot(db);
    const otroLead = await new LeadsRepo(db, otroBot).create({
      conversationId: null,
      intent: "x",
      channelUserId: null,
    });
    await new LeadContactsRepo(db, otroBot).add({
      leadId: otroLead,
      kind: "phone",
      addressRaw: "x",
      addressNorm: "+525512345678",
    });
    expect(await contacts.findByAddress(["+525512345678"])).toHaveLength(0);
  });

  it("borrar el lead se lleva sus contactos (no quedan huérfanos)", async () => {
    await contacts.add({ leadId, kind: "phone", addressRaw: "x", addressNorm: "+525512345678" });
    await db.run("DELETE FROM leads WHERE id = ?", [leadId]);
    expect(await contacts.listByLead(leadId)).toHaveLength(0);
  });
});

describe("OptOutsRepo", () => {
  it("registra la baja y la detecta", async () => {
    await optOuts.add("+525512345678", "escribió STOP");
    expect(await optOuts.isOptedOut(["+525512345678"])).toBe(true);
  });

  it("la baja vale para CUALQUIER forma del mismo número", async () => {
    // Se registra como lo manda WhatsApp…
    await optOuts.add("5215512345678");
    // …y se consulta con el canónico.
    expect(await optOuts.isOptedOut(phoneVariants("+525512345678"))).toBe(true);
  });

  it("SOBREVIVE a que el lead se borre y se vuelva a crear", async () => {
    // Es la razón de que la llave sea la dirección y no el lead: una baja que
    // se pierde al recrear la fila no es una baja.
    await optOuts.add("+525512345678", "escribió STOP");
    await db.run("DELETE FROM leads WHERE id = ?", [leadId]);
    await new LeadsRepo(db, TEST_BOT_ID).create({
      conversationId: null,
      contact: "55 1234 5678",
      channelUserId: null,
      intent: "vuelve a preguntar",
    });
    expect(await optOuts.isOptedOut(["+525512345678"])).toBe(true);
  });

  it("darse de baja dos veces no truena ni mueve la fecha", async () => {
    await optOuts.add("+525512345678", "primera");
    const antes = (await optOuts.list())[0].created_at;
    await optOuts.add("+525512345678", "segunda");
    const lista = await optOuts.list();
    expect(lista).toHaveLength(1);
    expect(lista[0].created_at).toBe(antes);
    expect(lista[0].reason).toBe("primera");
  });

  it("se puede reactivar a quien lo pide de vuelta", async () => {
    await optOuts.add("+525512345678");
    await optOuts.remove("+525512345678");
    expect(await optOuts.isOptedOut(["+525512345678"])).toBe(false);
  });

  it("la baja de un bot no afecta al otro", async () => {
    const otroBot = await createSecondTestBot(db);
    await new OptOutsRepo(db, otroBot).add("+525512345678");
    expect(await optOuts.isOptedOut(["+525512345678"])).toBe(false);
  });

  it("sin variantes que consultar, no está dado de baja", async () => {
    expect(await optOuts.isOptedOut([])).toBe(false);
  });
});
