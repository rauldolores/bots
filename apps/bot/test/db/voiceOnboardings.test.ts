// F7 fase 8: la máquina de estados del onboarding "conecta tu número
// existente" — pending → testing → connected → active, con failed/disabled
// como salidas, más los hitos del diagnóstico.
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID, createSecondTestBot } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { VoiceOnboardingsRepo, ONBOARDING_MILESTONES } from "../../src/db/voiceOnboardings";

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

describe("VoiceOnboardingsRepo — máquina de estados", () => {
  it("sin número destino, se crea en 'pending'", async () => {
    const row = await new VoiceOnboardingsRepo(db).create({ botId: TEST_BOT_ID, sourcePhoneNumber: "+5215500001111" });
    expect(row.status).toBe("pending");
    expect(row.destination_phone_number).toBeNull();
  });

  it("con número destino ya conocido, se crea directo en 'testing' (items 1-3 del flujo)", async () => {
    const row = await new VoiceOnboardingsRepo(db).create({
      botId: TEST_BOT_ID,
      sourcePhoneNumber: "+5215500001111",
      destinationPhoneNumber: "+18005550000",
    });
    expect(row.status).toBe("testing");
  });

  it("assignDestination: pasa de 'pending' a 'testing' cuando el destino llega después", async () => {
    const repo = new VoiceOnboardingsRepo(db);
    const row = await repo.create({ botId: TEST_BOT_ID, sourcePhoneNumber: "+5215500001111" });
    await repo.assignDestination(row.id, "+18005550000");
    const after = await repo.getById(row.id);
    expect(after?.status).toBe("testing");
    expect(after?.destination_phone_number).toBe("+18005550000");
  });

  it("items 6/7: markConnected pasa de 'testing' a 'connected' y registra verification_call_id + connected_at", async () => {
    const repo = new VoiceOnboardingsRepo(db);
    const row = await repo.create({ botId: TEST_BOT_ID, sourcePhoneNumber: "+5215500001111", destinationPhoneNumber: "+18005550000" });
    await repo.markConnected(row.id, "CAtest1234");
    const after = await repo.getById(row.id);
    expect(after?.status).toBe("connected");
    expect(after?.verification_call_id).toBe("CAtest1234");
    expect(after?.connected_at).toBeGreaterThan(0);
  });

  it("markConnected es idempotente: una SEGUNDA llamada de prueba no pisa el verification_call_id de la primera", async () => {
    const repo = new VoiceOnboardingsRepo(db);
    const row = await repo.create({ botId: TEST_BOT_ID, sourcePhoneNumber: "+5215500001111", destinationPhoneNumber: "+18005550000" });
    await repo.markConnected(row.id, "CAprimera");
    await repo.markConnected(row.id, "CAsegunda"); // status ya es 'connected', el WHERE status='testing' no matchea
    const after = await repo.getById(row.id);
    expect(after?.verification_call_id).toBe("CAprimera");
  });

  it("item 8: activate pasa de 'connected' a 'active' — nunca desde otro estado", async () => {
    const repo = new VoiceOnboardingsRepo(db);
    const otherBotId = await createSecondTestBot(db);

    const pending = await repo.create({ botId: TEST_BOT_ID, sourcePhoneNumber: "+5215500001111" });
    await repo.activate(pending.id, TEST_BOT_ID); // en 'pending' — no debe pasar nada
    expect((await repo.getById(pending.id))?.status).toBe("pending");

    const connected = await repo.create({ botId: otherBotId, sourcePhoneNumber: "+5215500002222", destinationPhoneNumber: "+18005550001" });
    await repo.markConnected(connected.id, "CAxxx");
    await repo.activate(connected.id, otherBotId);
    expect((await repo.getById(connected.id))?.status).toBe("active");
    expect((await repo.getById(connected.id))?.activated_at).toBeGreaterThan(0);
  });

  it("disable funciona desde cualquier estado no terminal, y respeta el aislamiento por bot", async () => {
    const repo = new VoiceOnboardingsRepo(db);
    const row = await repo.create({ botId: TEST_BOT_ID, sourcePhoneNumber: "+5215500001111", destinationPhoneNumber: "+18005550000" });
    const otherBotId = await createSecondTestBot(db);
    await repo.disable(row.id, otherBotId); // no es su onboarding — no debe tocarlo
    expect((await repo.getById(row.id))?.status).toBe("testing");

    await repo.disable(row.id, TEST_BOT_ID);
    expect((await repo.getById(row.id))?.status).toBe("disabled");
    expect((await repo.getById(row.id))?.disabled_at).toBeGreaterThan(0);
  });

  it("markFailed + retry: vuelve a 'testing' conservando el número de origen, y limpia los hitos del intento anterior", async () => {
    const repo = new VoiceOnboardingsRepo(db);
    const row = await repo.create({ botId: TEST_BOT_ID, sourcePhoneNumber: "+5215500001111", destinationPhoneNumber: "+18005550000" });
    await repo.recordMilestone(row.id, "number_detected");
    await repo.markFailed(row.id, TEST_BOT_ID);
    expect((await repo.getById(row.id))?.status).toBe("failed");

    const retried = await repo.retry(row.id, TEST_BOT_ID);
    expect(retried?.status).toBe("testing"); // ya tenía destino
    expect(retried?.source_phone_number).toBe("+5215500001111"); // no se pierde
    expect(await repo.listMilestones(row.id)).toHaveLength(0); // hitos del intento anterior, limpios
  });

  it("un bot solo puede tener UN onboarding en curso a la vez (índice único parcial)", async () => {
    const repo = new VoiceOnboardingsRepo(db);
    await repo.create({ botId: TEST_BOT_ID, sourcePhoneNumber: "+5215500001111" });
    await expect(repo.create({ botId: TEST_BOT_ID, sourcePhoneNumber: "+5215500002222" })).rejects.toThrow();
  });

  it("tras failed/disabled, SÍ se puede crear uno nuevo (no cuentan como 'en curso')", async () => {
    const repo = new VoiceOnboardingsRepo(db);
    const row = await repo.create({ botId: TEST_BOT_ID, sourcePhoneNumber: "+5215500001111" });
    await repo.markFailed(row.id, TEST_BOT_ID);
    await expect(repo.create({ botId: TEST_BOT_ID, sourcePhoneNumber: "+5215500002222" })).resolves.toBeTruthy();
  });

  it("aislamiento multi-tenant: getActiveForBot de un bot nunca trae el de otro", async () => {
    const otherBotId = await createSecondTestBot(db);
    await new VoiceOnboardingsRepo(db).create({ botId: otherBotId, sourcePhoneNumber: "+5215500009999" });
    expect(await new VoiceOnboardingsRepo(db).getActiveForBot(TEST_BOT_ID)).toBeNull();
  });
});

describe("VoiceOnboardingsRepo — hitos del diagnóstico", () => {
  it("recordMilestone es idempotente — el mismo hito dos veces no duplica ni pisa el timestamp original", async () => {
    const repo = new VoiceOnboardingsRepo(db);
    const row = await repo.create({ botId: TEST_BOT_ID, sourcePhoneNumber: "+5215500001111", destinationPhoneNumber: "+18005550000" });
    await repo.recordMilestone(row.id, "number_detected");
    const first = (await repo.listMilestones(row.id))[0].occurred_at;
    await new Promise((r) => setTimeout(r, 5));
    await repo.recordMilestone(row.id, "number_detected");
    const milestones = await repo.listMilestones(row.id);
    expect(milestones).toHaveLength(1);
    expect(milestones[0].occurred_at).toBe(first);
  });

  it("findObservable: solo 'testing'/'connected' — nunca 'pending', 'active', 'failed' o 'disabled'", async () => {
    const repo = new VoiceOnboardingsRepo(db);
    const pending = await repo.create({ botId: TEST_BOT_ID, sourcePhoneNumber: "+5215500001111" });
    expect(await repo.findObservable(TEST_BOT_ID)).toBeNull();

    await repo.assignDestination(pending.id, "+18005550000");
    expect((await repo.findObservable(TEST_BOT_ID))?.id).toBe(pending.id);

    await repo.markConnected(pending.id, "CAxxx");
    expect((await repo.findObservable(TEST_BOT_ID))?.id).toBe(pending.id);

    await repo.activate(pending.id, TEST_BOT_ID);
    expect(await repo.findObservable(TEST_BOT_ID)).toBeNull();
  });

  it("los 7 hitos existen y están en el orden del enunciado", () => {
    expect(ONBOARDING_MILESTONES).toEqual([
      "number_detected",
      "call_received",
      "twilio_connected",
      "agent_identified",
      "voice_session_created",
      "openai_connected",
      "first_response_generated",
    ]);
  });
});
