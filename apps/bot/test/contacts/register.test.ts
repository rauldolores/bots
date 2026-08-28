// registerLeadContacts() — la parte que clasifica channel_user_id de la
// CONVERSACIÓN (no lo que el cliente dictó). Antes de F9, cualquier canal
// cuyo identificador no fuera un teléfono caía como kind='channel' (opaco) —
// correcto para Telegram/Messenger, pero equivocado para "email", donde
// channel_user_id ES un correo real, no un identificador opaco.
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { LeadsRepo } from "../../src/db/leads";
import { LeadContactsRepo } from "../../src/db/leadContacts";
import { registerLeadContacts } from "../../src/contacts/register";

let db: Db;
let leadId: string;

beforeEach(async () => {
  db = await createTestDb();
  leadId = await new LeadsRepo(db, TEST_BOT_ID).create({
    conversationId: null,
    channelUserId: "cliente@ejemplo.com",
    intent: "prueba",
  });
});

describe("registerLeadContacts — canal 'email'", () => {
  it("channel_user_id de un canal 'email' se guarda como kind='email', no 'channel'", async () => {
    await registerLeadContacts(db, TEST_BOT_ID, leadId, null, { channel: "email", channel_user_id: "Cliente@Ejemplo.com" });

    const contacts = await new LeadContactsRepo(db, TEST_BOT_ID).listByLead(leadId);
    expect(contacts).toContainEqual(
      expect.objectContaining({ kind: "email", address_norm: "cliente@ejemplo.com", consent: "inbound", verified: true }),
    );
    expect(contacts.some((c) => c.kind === "channel")).toBe(false);
  });

  it("un canal telefónico (twilio) sigue registrándose como 'phone', sin cambios", async () => {
    await registerLeadContacts(db, TEST_BOT_ID, leadId, null, { channel: "twilio", channel_user_id: "+5215512345678" });
    const contacts = await new LeadContactsRepo(db, TEST_BOT_ID).listByLead(leadId);
    expect(contacts).toContainEqual(expect.objectContaining({ kind: "phone", address_norm: "+525512345678" }));
  });

  it("un canal opaco (telegram) sigue registrándose como 'channel', sin cambios", async () => {
    await registerLeadContacts(db, TEST_BOT_ID, leadId, null, { channel: "telegram", channel_user_id: "12345" });
    const contacts = await new LeadContactsRepo(db, TEST_BOT_ID).listByLead(leadId);
    expect(contacts).toContainEqual(expect.objectContaining({ kind: "channel", channel: "telegram", address_norm: "telegram:12345" }));
  });

  it("es idempotente — correrlo dos veces sobre el mismo lead no duplica", async () => {
    await registerLeadContacts(db, TEST_BOT_ID, leadId, null, { channel: "email", channel_user_id: "cliente@ejemplo.com" });
    await registerLeadContacts(db, TEST_BOT_ID, leadId, null, { channel: "email", channel_user_id: "cliente@ejemplo.com" });
    const contacts = await new LeadContactsRepo(db, TEST_BOT_ID).listByLead(leadId);
    expect(contacts.filter((c) => c.kind === "email")).toHaveLength(1);
  });
});
