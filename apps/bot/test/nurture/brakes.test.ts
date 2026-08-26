import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { LeadsRepo } from "../../src/db/leads";
import { LeadContactsRepo } from "../../src/db/leadContacts";
import { localHour } from "../../src/datetime";
import {
  nextAllowedTime,
  gatherContactContext,
  hasRepliedSince,
  isFreeformWindow,
  ALLOWED_HOUR_START,
} from "../../src/nurture/brakes";

const TZ = "America/Mexico_City"; // UTC-6 fijo (sin horario de verano) — determinista para el test.

describe("nextAllowedTime — horario permitido", () => {
  it("no mueve nada si ya es horario permitido", () => {
    const now = Date.UTC(2026, 0, 15, 16, 0, 0); // 10:00 local
    expect(nextAllowedTime(now, TZ)).toBe(now);
  });

  it("adelanta al inicio de la ventana el mismo día si es temprano", () => {
    const now = Date.UTC(2026, 0, 15, 11, 0, 0); // 05:00 local
    const result = nextAllowedTime(now, TZ);
    expect(result).toBeGreaterThan(now);
    expect(localHour(result, TZ)).toBe(ALLOWED_HOUR_START);
    expect(new Date(result).toISOString().slice(0, 10)).toBe("2026-01-15");
  });

  it("adelanta al día siguiente si ya pasó la ventana", () => {
    const now = Date.UTC(2026, 0, 16, 3, 0, 0); // 2026-01-15 21:00 local
    const result = nextAllowedTime(now, TZ);
    expect(result).toBeGreaterThan(now);
    expect(localHour(result, TZ)).toBe(ALLOWED_HOUR_START);
    expect(new Date(result).toISOString().slice(0, 10)).toBe("2026-01-16");
  });

  it("el fin de la ventana es EXCLUSIVO: justo a esa hora ya no es válido", () => {
    const now = Date.UTC(2026, 0, 16, 2, 0, 0); // 20:00 local
    const result = nextAllowedTime(now, TZ);
    expect(result).not.toBe(now);
  });
});

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

describe("gatherContactContext", () => {
  it("encuentra la conversación propia del lead", async () => {
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("twilio", "+5215512345678");
    const leadId = await new LeadsRepo(db, TEST_BOT_ID).create({
      conversationId: conv.id,
      channelUserId: conv.channel_user_id,
      intent: "x",
    });
    const lead = (await new LeadsRepo(db, TEST_BOT_ID).getById(leadId))!;
    const ctx = await gatherContactContext(db, TEST_BOT_ID, lead);
    expect(ctx.sendConversation?.id).toBe(conv.id);
    expect(ctx.conversations).toHaveLength(1);
  });

  it("cruza por lead_contacts aunque el lead no tenga conversation_id directa (backfill)", async () => {
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("twilio", "+5215512345678");
    const leadId = await new LeadsRepo(db, TEST_BOT_ID).create({
      conversationId: null,
      channelUserId: null,
      contact: "55 1234 5678",
      intent: "x",
    });
    await new LeadContactsRepo(db, TEST_BOT_ID).add({
      leadId,
      kind: "phone",
      addressRaw: "55 1234 5678",
      addressNorm: "+525512345678",
    });
    const lead = (await new LeadsRepo(db, TEST_BOT_ID).getById(leadId))!;
    const ctx = await gatherContactContext(db, TEST_BOT_ID, lead);
    expect(ctx.sendConversation?.id).toBe(conv.id);
  });

  it("null cuando no existe ninguna conversación con este lead (no se contacta en frío)", async () => {
    const leadId = await new LeadsRepo(db, TEST_BOT_ID).create({
      conversationId: null,
      channelUserId: null,
      contact: "ana@ejemplo.com",
      intent: "x",
    });
    const lead = (await new LeadsRepo(db, TEST_BOT_ID).getById(leadId))!;
    const ctx = await gatherContactContext(db, TEST_BOT_ID, lead);
    expect(ctx.sendConversation).toBeNull();
    expect(ctx.conversations).toHaveLength(0);
  });

  it("incluye las variantes de opt-out del canal encontrado aunque lead_contacts esté vacío", async () => {
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("twilio", "+5215512345678");
    const leadId = await new LeadsRepo(db, TEST_BOT_ID).create({
      conversationId: conv.id,
      channelUserId: conv.channel_user_id,
      intent: "x",
    });
    const lead = (await new LeadsRepo(db, TEST_BOT_ID).getById(leadId))!;
    const ctx = await gatherContactContext(db, TEST_BOT_ID, lead);
    expect(ctx.optOutVariants).toContain("+525512345678");
  });
});

describe("hasRepliedSince", () => {
  it("false sin conversaciones", async () => {
    expect(await hasRepliedSince(db, [], Date.now())).toBe(false);
  });

  it("true si el cliente escribió después de sinceMs", async () => {
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("twilio", "+5215512345678");
    const sinceMs = Date.now() - 1000;
    await new MessagesRepo(db, TEST_BOT_ID).append(conv.id, "user", "hola, sigo interesado");
    expect(await hasRepliedSince(db, [conv], sinceMs)).toBe(true);
  });

  it("false si el único mensaje es anterior a sinceMs, o es del asistente", async () => {
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("twilio", "+5215512345678");
    await new MessagesRepo(db, TEST_BOT_ID).append(conv.id, "assistant", "seguimiento");
    expect(await hasRepliedSince(db, [conv], Date.now() - 1000)).toBe(false);
  });
});

describe("isFreeformWindow", () => {
  it("true fuera de WhatsApp/Twilio, sin importar cuándo escribió", async () => {
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("telegram", "418122771");
    expect(await isFreeformWindow(db, conv, Date.now())).toBe(true);
  });

  it("true en twilio si el cliente escribió hace poco", async () => {
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("twilio", "+5215512345678");
    await new MessagesRepo(db, TEST_BOT_ID).append(conv.id, "user", "hola");
    expect(await isFreeformWindow(db, conv, Date.now())).toBe(true);
  });

  it("false en twilio si nunca escribió, o si escribió hace más de 23h", async () => {
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("twilio", "+5215512345678");
    expect(await isFreeformWindow(db, conv, Date.now())).toBe(false);

    await db.run("UPDATE messages SET created_at = ? WHERE conversation_id = ?", [
      Date.now() - 25 * 3600_000,
      conv.id,
    ]);
    await new MessagesRepo(db, TEST_BOT_ID).append(conv.id, "user", "hola");
    await db.run(
      "UPDATE messages SET created_at = ? WHERE conversation_id = ? AND role = 'user'",
      [Date.now() - 25 * 3600_000, conv.id],
    );
    expect(await isFreeformWindow(db, conv, Date.now())).toBe(false);
  });
});
