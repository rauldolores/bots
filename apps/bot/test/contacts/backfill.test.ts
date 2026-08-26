/**
 * scripts/backfill-lead-contacts.ts — probado a través de su lógica compartida
 * (contacts/register.ts), sobre leads sembrados como quedaron ANTES de F8:
 * solo `contact` de texto libre, sin fila en lead_contacts.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, createSecondTestBot, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { LeadsRepo } from "../../src/db/leads";
import { LeadContactsRepo } from "../../src/db/leadContacts";
import { registerLeadContacts } from "../../src/contacts/register";

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

/** Simula exactamente lo que hace el script: unir leads con su conversación y procesar cada fila. */
async function correrBackfill(botId: string) {
  const filas = await db.all<{
    lead_id: string;
    contact: string | null;
    channel: string | null;
    channel_user_id: string | null;
  }>(
    `SELECT l.id as lead_id, l.contact, c.channel, c.channel_user_id
     FROM leads l LEFT JOIN conversations c ON c.id = l.conversation_id
     WHERE l.bot_id = ?`,
    [botId],
  );
  for (const f of filas) {
    const conv = f.channel && f.channel_user_id ? { channel: f.channel, channel_user_id: f.channel_user_id } : null;
    await registerLeadContacts(db, botId, f.lead_id, f.contact, conv);
  }
  return filas.length;
}

describe("backfill de leads viejos", () => {
  it("un lead capturado ANTES de F8 (solo contact, sin conversación) queda tipado", async () => {
    const leadId = await new LeadsRepo(db, TEST_BOT_ID).create({
      conversationId: null,
      channelUserId: null,
      contact: "55 1234 5678",
      intent: "quiere el curso",
    });

    await correrBackfill(TEST_BOT_ID);

    const contactos = await new LeadContactsRepo(db, TEST_BOT_ID).listByLead(leadId);
    expect(contactos).toEqual([
      expect.objectContaining({ kind: "phone", address_norm: "+525512345678", consent: "inbound" }),
    ]);
  });

  it("un lead con conversación de WhatsApp también tipa el contacto DEL CANAL", async () => {
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("twilio", "+5215512345678");
    const leadId = await new LeadsRepo(db, TEST_BOT_ID).create({
      conversationId: conv.id,
      channelUserId: conv.channel_user_id,
      contact: "ana@ejemplo.com",
      intent: "cotización",
    });

    await correrBackfill(TEST_BOT_ID);

    const contactos = await new LeadContactsRepo(db, TEST_BOT_ID).listByLead(leadId);
    // El correo dictado Y el teléfono de WhatsApp (normalizado, sin el "1" legacy).
    expect(contactos).toContainEqual(
      expect.objectContaining({ kind: "email", address_norm: "ana@ejemplo.com" }),
    );
    expect(contactos).toContainEqual(
      expect.objectContaining({ kind: "phone", address_norm: "+525512345678", verified: true }),
    );
  });

  it("un lead de Telegram (canal opaco) queda como 'channel', no como teléfono inventado", async () => {
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("telegram", "418122771");
    const leadId = await new LeadsRepo(db, TEST_BOT_ID).create({
      conversationId: conv.id,
      channelUserId: conv.channel_user_id,
      intent: "pregunta horarios",
    });

    await correrBackfill(TEST_BOT_ID);

    const contactos = await new LeadContactsRepo(db, TEST_BOT_ID).listByLead(leadId);
    expect(contactos).toEqual([
      expect.objectContaining({ kind: "channel", channel: "telegram", address_norm: "telegram:418122771" }),
    ]);
  });

  it("un lead sin ningún contacto usable no genera filas — no truena, no inventa", async () => {
    const leadId = await new LeadsRepo(db, TEST_BOT_ID).create({
      conversationId: null,
      channelUserId: null,
      contact: "me llamo Ana",
      intent: "x",
    });

    await correrBackfill(TEST_BOT_ID);
    expect(await new LeadContactsRepo(db, TEST_BOT_ID).listByLead(leadId)).toEqual([]);
  });

  it("es IDEMPOTENTE: correrlo dos veces no duplica nada", async () => {
    await new LeadsRepo(db, TEST_BOT_ID).create({
      conversationId: null,
      channelUserId: null,
      contact: "55 1234 5678",
      intent: "x",
    });

    await correrBackfill(TEST_BOT_ID);
    const primeraVez = await db.all("SELECT id FROM lead_contacts WHERE bot_id = ?", [TEST_BOT_ID]);
    await correrBackfill(TEST_BOT_ID);
    const segundaVez = await db.all("SELECT id FROM lead_contacts WHERE bot_id = ?", [TEST_BOT_ID]);

    expect(segundaVez.length).toBe(primeraVez.length);
  });

  it("un bot no ve ni procesa los leads de otro", async () => {
    const otroBot = await createSecondTestBot(db);
    await new LeadsRepo(db, otroBot).create({
      conversationId: null,
      channelUserId: null,
      contact: "55 1234 5678",
      intent: "x",
    });
    await new LeadsRepo(db, TEST_BOT_ID).create({
      conversationId: null,
      channelUserId: null,
      contact: "ana@x.com",
      intent: "x",
    });

    await correrBackfill(TEST_BOT_ID);

    expect(await db.all("SELECT id FROM lead_contacts WHERE bot_id = ?", [TEST_BOT_ID])).toHaveLength(1);
    expect(await db.all("SELECT id FROM lead_contacts WHERE bot_id = ?", [otroBot])).toHaveLength(0);
  });
});
