// F7 fase 9: la tool transfer_to_human — la parte de "negocio" (deja un
// resumen para el operador como ticket) que se ejecuta ANTES de que
// RealtimeCallBridge dispare la transferencia telefónica real. NO hace
// ninguna llamada a Twilio — eso lo prueba voiceTransfer.test.ts.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { BotChannelsRepo } from "../../src/db/botChannels";
import { BotConnectorsRepo } from "../../src/db/botConnectors";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { TicketsRepo } from "../../src/db/tickets";
import { transferToHumanTool } from "../../src/channels/voice/tools/transferToHuman";

let db: Db;
let env: any;

beforeEach(async () => {
  db = await createTestDb();
  env = { DB: db.driver };
});

async function connectVoiceWithTransferNumber(transferNumber: string | null): Promise<void> {
  await new BotChannelsRepo(db).upsert({
    botId: TEST_BOT_ID,
    channel: "voice",
    config: { accountSid: "ACxxxx", voiceNumber: "+18005551212", ...(transferNumber ? { transferNumber } : {}) },
  });
}

describe("transferToHumanTool", () => {
  it("sin número de transferencia configurado, devuelve error y NO crea ticket", async () => {
    await connectVoiceWithTransferNumber(null);
    const tool = transferToHumanTool(env, TEST_BOT_ID, () => null);
    const result = (await tool.execute!({ destination: "ventas", reason: "quiere hablar con alguien", summary: "cliente molesto" }, {} as any)) as any;
    expect(result.error).toBe("transfer_not_configured");
    expect(await new TicketsRepo(db, TEST_BOT_ID).listOpen()).toHaveLength(0);
  });

  it("con número configurado, crea un ticket con el resumen y los datos del cliente, y devuelve ok+ticketId", async () => {
    await connectVoiceWithTransferNumber("+525512345678");
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("voice", "+5215500001111", "Carla Voz");
    await new MessagesRepo(db, TEST_BOT_ID).append(conv.id, "user", "Quiero reservar mesa para 4 mañana a las 8");

    const tool = transferToHumanTool(env, TEST_BOT_ID, () => conv.id);
    const result = (await tool.execute!(
      { destination: "recepción", reason: "quiere hablar con alguien", summary: "reservar mesa para 4 personas mañana 8pm" },
      {} as any,
    )) as any;

    expect(result.ok).toBe(true);
    expect(result.destination).toBe("recepción");
    expect(result.ticketId).toBeTruthy();

    const ticket = await new TicketsRepo(db, TEST_BOT_ID).getById(result.ticketId);
    expect(ticket?.category).toBe("transfer");
    expect(ticket?.priority).toBe("high");
    expect(ticket?.summary).toContain("recepción");
    expect(ticket?.summary).toContain("reservar mesa para 4 personas");
    expect(ticket?.requester_name).toBe("Carla Voz");
    expect(ticket?.requester_contact).toBe("+5215500001111");
    expect(ticket?.transcript).toContain("Quiero reservar mesa para 4 mañana a las 8");
  });

  it("marca la conversación con el ticket abierto (igual que handoffHuman)", async () => {
    await connectVoiceWithTransferNumber("+525512345678");
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("voice", "+5215500002222");
    const tool = transferToHumanTool(env, TEST_BOT_ID, () => conv.id);
    const result = (await tool.execute!({ destination: "soporte", reason: "problema técnico", summary: "no le funciona algo" }, {} as any)) as any;

    const updatedConv = await new ConversationsRepo(db, TEST_BOT_ID).getById(conv.id);
    expect(updatedConv?.open_ticket_id).toBe(result.ticketId);
  });

  it("sin conversationId, igual crea el ticket (sin nombre/contacto ni transcripción)", async () => {
    await connectVoiceWithTransferNumber("+525512345678");
    const tool = transferToHumanTool(env, TEST_BOT_ID, () => null);
    const result = (await tool.execute!({ destination: "ventas", reason: "quiere info", summary: "pregunta de precios" }, {} as any)) as any;
    expect(result.ok).toBe(true);
    const ticket = await new TicketsRepo(db, TEST_BOT_ID).getById(result.ticketId);
    expect(ticket?.requester_name).toBeNull();
    expect(ticket?.conversation_id).toBeNull();
  });

  it("si hay una plataforma de tickets conectada, también empuja ahí (best-effort, no truena si falla)", async () => {
    await connectVoiceWithTransferNumber("+525512345678");
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "tickets",
      provider: "zendesk",
      secretRef: null,
      config: { subdomain: "test" },
    });
    const tool = transferToHumanTool(env, TEST_BOT_ID, () => null);
    // Sin credenciales reales de Zendesk el push falla silenciosamente
    // (resolveConnectorCreds no encuentra secretRef) — lo importante es que
    // el ticket local SIEMPRE se crea, sin importar la plataforma externa.
    const result = (await tool.execute!({ destination: "ventas", reason: "x", summary: "y" }, {} as any)) as any;
    expect(result.ok).toBe(true);
  });
});
