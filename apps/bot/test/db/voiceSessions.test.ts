import { describe, it, expect, beforeEach } from "vitest";
import { Db } from "../../src/db/client";
import { createTestDb, TEST_BOT_ID, createSecondTestBot } from "../helpers/pgSetup";
import { ConversationsRepo } from "../../src/db/conversations";
import { VoiceSessionsRepo } from "../../src/db/voiceSessions";

let db: Db;
let repo: VoiceSessionsRepo;
let convId: string;

beforeEach(async () => {
  db = await createTestDb();
  repo = new VoiceSessionsRepo(db, TEST_BOT_ID);
  const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("voice", "+5215500000000");
  convId = conv.id;
});

describe("VoiceSessionsRepo", () => {
  it("crea una sesión en estado 'initiated', sin provider_call_id todavía", async () => {
    const id = await repo.create({ conversationId: convId, provider: "twilio", callerId: "+5215500000000" });
    const row = await repo.getById(id);
    expect(row?.status).toBe("initiated");
    expect(row?.caller_id).toBe("+5215500000000");
    expect(row?.provider).toBe("twilio");
    expect(row?.provider_call_id).toBeNull();
    expect(row?.conversation_id).toBe(convId);
  });

  it("setProviderCallId guarda el id del proveedor una vez conocido", async () => {
    const id = await repo.create({ conversationId: convId, provider: "twilio", callerId: "+5215500000000" });
    await repo.setProviderCallId(id, "CA1234567890");
    expect((await repo.getById(id))?.provider_call_id).toBe("CA1234567890");
  });

  it("setStatus cambia el estado", async () => {
    const id = await repo.create({ conversationId: convId, provider: "twilio", callerId: "+5215500000000" });
    await repo.setStatus(id, "active");
    expect((await repo.getById(id))?.status).toBe("active");
  });

  it("end cierra la sesión con motivo y marca ended_at", async () => {
    const id = await repo.create({ conversationId: convId, provider: "twilio", callerId: "+5215500000000" });
    await repo.end(id, "completed", "colgó el cliente");
    const row = await repo.getById(id);
    expect(row?.status).toBe("completed");
    expect(row?.ended_reason).toBe("colgó el cliente");
    expect(row?.ended_at).toBeTruthy();
  });

  it("un bot no ve las sesiones de voz de otro", async () => {
    const otherBotId = await createSecondTestBot(db);
    const otherConv = await new ConversationsRepo(db, otherBotId).getOrCreate("voice", "+5215588888888");
    const theirId = await new VoiceSessionsRepo(db, otherBotId).create({
      conversationId: otherConv.id,
      provider: "twilio",
      callerId: "+5215588888888",
    });
    expect(await repo.getById(theirId)).toBeNull();
  });

  it("getByProviderCallId resuelve por CallSid — lo único que conoce el webhook de resultado de transferencia", async () => {
    const id = await repo.create({ conversationId: convId, provider: "twilio", callerId: "+5215500000000", providerCallId: "CAxxx" });
    const row = await repo.getByProviderCallId("CAxxx");
    expect(row?.id).toBe(id);
    expect(await repo.getByProviderCallId("CAnoexiste")).toBeNull();
  });
});

describe("VoiceSessionsRepo — F7 fase 10: observabilidad y analytics", () => {
  it("markAnswered marca answered_at UNA sola vez (la primera gana)", async () => {
    const id = await repo.create({ conversationId: convId, provider: "twilio", callerId: "+5215500000000" });
    await repo.markAnswered(id);
    const first = (await repo.getById(id))?.answered_at;
    expect(first).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 5));
    await repo.markAnswered(id);
    expect((await repo.getById(id))?.answered_at).toBe(first);
  });

  it("setTransferStatus refleja las 5 fases", async () => {
    const id = await repo.create({ conversationId: convId, provider: "twilio", callerId: "+5215500000000" });
    expect((await repo.getById(id))?.transfer_status).toBe("none");
    for (const status of ["requested", "started", "completed", "failed"] as const) {
      await repo.setTransferStatus(id, status);
      expect((await repo.getById(id))?.transfer_status).toBe(status);
    }
  });

  it("incrementToolCall: 'other' solo suma tool_call_count; 'rag'/'mcp' TAMBIÉN suman su contador específico", async () => {
    const id = await repo.create({ conversationId: convId, provider: "twilio", callerId: "+5215500000000" });
    await repo.incrementToolCall(id, "other");
    await repo.incrementToolCall(id, "rag");
    await repo.incrementToolCall(id, "mcp");
    await repo.incrementToolCall(id, "rag");
    const row = await repo.getById(id);
    expect(row?.tool_call_count).toBe(4);
    expect(row?.rag_query_count).toBe(2);
    expect(row?.mcp_call_count).toBe(1);
  });

  it("incrementInterruption acumula", async () => {
    const id = await repo.create({ conversationId: convId, provider: "twilio", callerId: "+5215500000000" });
    await repo.incrementInterruption(id);
    await repo.incrementInterruption(id);
    expect((await repo.getById(id))?.interruption_count).toBe(2);
  });

  it("setFirstAudioLatency solo aplica la PRIMERA vez — 'time to first audio' es de toda la llamada, no por turno", async () => {
    const id = await repo.create({ conversationId: convId, provider: "twilio", callerId: "+5215500000000" });
    await repo.setFirstAudioLatency(id, 800);
    await repo.setFirstAudioLatency(id, 200); // un turno posterior, más rápido — no debe pisar el primero
    expect((await repo.getById(id))?.time_to_first_audio_ms).toBe(800);
  });

  it("addResponseLatency SUMA (no reemplaza) — total_response_latency es de toda la llamada", async () => {
    const id = await repo.create({ conversationId: convId, provider: "twilio", callerId: "+5215500000000" });
    await repo.addResponseLatency(id, 500);
    await repo.addResponseLatency(id, 300);
    expect((await repo.getById(id))?.total_response_latency_ms).toBe(800);
  });

  it("setTranscript / finalize guardan el transcript estructurado y los agregados finales", async () => {
    const id = await repo.create({ conversationId: convId, provider: "twilio", callerId: "+5215500000000" });
    await repo.setTranscript(id, [
      { role: "user", text: "hola", at: 1000 },
      { role: "assistant", text: "¡hola! ¿en qué ayudo?", at: 1500, toolCalls: [{ toolName: "searchKb", input: { query: "x" } }] },
    ]);
    await repo.finalize(id, { durationMs: 45_000, estimatedAiCostUsd: 0.0123, estimatedTelephonyCostUsd: 0.0021 });
    const row = await repo.getById(id);
    expect(row?.transcript).toHaveLength(2);
    expect(row?.transcript?.[1].toolCalls?.[0].toolName).toBe("searchKb");
    expect(row?.duration_ms).toBe(45_000);
    expect(row?.estimated_ai_cost_usd).toBe(0.0123);
    expect(row?.estimated_telephony_cost_usd).toBe(0.0021);
  });

  it("sin setTranscript, el transcript queda NULL — 'no almacenar datos sensibles innecesariamente' por default", async () => {
    const id = await repo.create({ conversationId: convId, provider: "twilio", callerId: "+5215500000000" });
    expect((await repo.getById(id))?.transcript).toBeNull();
  });
});
