import { Db } from "./client";

/** Abierto a propósito (F7 fase 8): hoy solo 'call_forwarding' está implementado — ver channels/voice/onboarding/types.ts para cómo se agrega 'porting'/'sip_byoc' sin migrar esta tabla otra vez. */
export type VoiceOnboardingMethod = "call_forwarding" | "porting" | "sip_byoc";

export type VoiceOnboardingStatus = "pending" | "testing" | "connected" | "active" | "failed" | "disabled";

/** Los 7 hitos de la pantalla de diagnóstico, en el orden en que normalmente ocurren durante una llamada real. */
export type OnboardingMilestone =
  | "number_detected"
  | "call_received"
  | "twilio_connected"
  | "agent_identified"
  | "voice_session_created"
  | "openai_connected"
  | "first_response_generated";

export const ONBOARDING_MILESTONES: OnboardingMilestone[] = [
  "number_detected",
  "call_received",
  "twilio_connected",
  "agent_identified",
  "voice_session_created",
  "openai_connected",
  "first_response_generated",
];

export interface VoiceOnboardingRow {
  id: string;
  bot_id: string;
  method: VoiceOnboardingMethod;
  source_phone_number: string;
  destination_phone_number: string | null;
  status: VoiceOnboardingStatus;
  verification_call_id: string | null;
  connected_at: number | null;
  activated_at: number | null;
  disabled_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface OnboardingMilestoneEvent {
  milestone: OnboardingMilestone;
  occurred_at: number;
}

/**
 * El onboarding de "conecta tu número existente" (F7 fase 8) — una fila por
 * intento, con su propia máquina de estados (pending→testing→connected→
 * active, con failed/disabled como salidas). Un bot solo puede tener UNO EN
 * CURSO a la vez (índice único parcial en la migración); el historial de
 * intentos fallidos/desactivados se conserva.
 */
export class VoiceOnboardingsRepo {
  constructor(private readonly db: Db) {}

  async create(input: {
    botId: string;
    method?: VoiceOnboardingMethod;
    sourcePhoneNumber: string;
    destinationPhoneNumber?: string | null;
  }): Promise<VoiceOnboardingRow> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const status: VoiceOnboardingStatus = input.destinationPhoneNumber ? "testing" : "pending";
    await this.db.run(
      `INSERT INTO voice_onboardings (id, bot_id, method, source_phone_number, destination_phone_number, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.botId,
        input.method ?? "call_forwarding",
        input.sourcePhoneNumber,
        input.destinationPhoneNumber ?? null,
        status,
        now,
        now,
      ],
    );
    return (await this.getById(id))!;
  }

  async getById(id: string): Promise<VoiceOnboardingRow | null> {
    return this.db.first<VoiceOnboardingRow>("SELECT * FROM voice_onboardings WHERE id = ?", [id]);
  }

  /** El de este bot que sigue EN CURSO (no terminal) — como mucho uno, por el índice único parcial. */
  async getActiveForBot(botId: string): Promise<VoiceOnboardingRow | null> {
    return this.db.first<VoiceOnboardingRow>(
      "SELECT * FROM voice_onboardings WHERE bot_id = ? AND status NOT IN ('failed', 'disabled') ORDER BY created_at DESC LIMIT 1",
      [botId],
    );
  }

  /** El más reciente sin importar estado — para poder mostrar/reintentar uno que terminó en failed. */
  async getLatestForBot(botId: string): Promise<VoiceOnboardingRow | null> {
    return this.db.first<VoiceOnboardingRow>("SELECT * FROM voice_onboardings WHERE bot_id = ? ORDER BY created_at DESC LIMIT 1", [
      botId,
    ]);
  }

  /** El que está esperando la llamada de prueba o ya la recibió — el único momento en que vale la pena registrar hitos de diagnóstico (ver onboarding/milestones.ts). */
  async findObservable(botId: string): Promise<VoiceOnboardingRow | null> {
    return this.db.first<VoiceOnboardingRow>(
      "SELECT * FROM voice_onboardings WHERE bot_id = ? AND status IN ('testing', 'connected') ORDER BY created_at DESC LIMIT 1",
      [botId],
    );
  }

  /** Item 3 del flujo, cuando el destino no se conocía al crear la fila — pasa a 'testing' en cuanto se asigna. */
  async assignDestination(id: string, destinationPhoneNumber: string): Promise<void> {
    await this.db.run(
      "UPDATE voice_onboardings SET destination_phone_number = ?, status = 'testing', updated_at = ? WHERE id = ? AND status = 'pending'",
      [destinationPhoneNumber, Date.now(), id],
    );
  }

  /**
   * Items 6/7 del flujo: detectamos la llamada de prueba y confirmamos la
   * conexión. Idempotente por el WHERE status='testing' — una segunda
   * llamada de prueba (ya en 'connected') no pisa el verification_call_id
   * ni el connected_at de la primera.
   */
  async markConnected(id: string, verificationCallId: string): Promise<void> {
    await this.db.run(
      `UPDATE voice_onboardings SET status = 'connected', verification_call_id = ?, connected_at = ?, updated_at = ?
       WHERE id = ? AND status = 'testing'`,
      [verificationCallId, Date.now(), Date.now(), id],
    );
  }

  /** Item 8 del flujo: el cliente revisó el diagnóstico y confirma — el agente queda activo para esa línea. */
  async activate(id: string, botId: string): Promise<void> {
    await this.db.run(
      "UPDATE voice_onboardings SET status = 'active', activated_at = ?, updated_at = ? WHERE id = ? AND bot_id = ? AND status = 'connected'",
      [Date.now(), Date.now(), id, botId],
    );
  }

  /** Apagado explícito — a diferencia de failed, esto lo pide el propio cliente (ej. cambió de opinión, quiere usar otra línea). */
  async disable(id: string, botId: string): Promise<void> {
    await this.db.run(
      "UPDATE voice_onboardings SET status = 'disabled', disabled_at = ?, updated_at = ? WHERE id = ? AND bot_id = ?",
      [Date.now(), Date.now(), id, botId],
    );
  }

  /** La llamada de prueba nunca llegó — el cliente (o un timeout futuro) lo marca así en vez de dejarlo esperando para siempre. */
  async markFailed(id: string, botId: string): Promise<void> {
    await this.db.run(
      "UPDATE voice_onboardings SET status = 'failed', updated_at = ? WHERE id = ? AND bot_id = ? AND status IN ('pending', 'testing')",
      [Date.now(), id, botId],
    );
  }

  /** Reintentar tras un failed: vuelve a 'testing' (si ya tenía destino) o 'pending', y limpia los hitos de diagnóstico del intento anterior. */
  async retry(id: string, botId: string): Promise<VoiceOnboardingRow | null> {
    const row = await this.db.first<VoiceOnboardingRow>(
      "SELECT * FROM voice_onboardings WHERE id = ? AND bot_id = ? AND status = 'failed'",
      [id, botId],
    );
    if (!row) return null;
    const status: VoiceOnboardingStatus = row.destination_phone_number ? "testing" : "pending";
    await this.db.run("UPDATE voice_onboardings SET status = ?, updated_at = ? WHERE id = ?", [status, Date.now(), id]);
    await this.db.run("DELETE FROM voice_onboarding_events WHERE onboarding_id = ?", [id]);
    return this.getById(id);
  }

  /** Un hito del diagnóstico — idempotente (UNIQUE onboarding_id+milestone en la migración). */
  async recordMilestone(id: string, milestone: OnboardingMilestone): Promise<void> {
    await this.db.run(
      `INSERT INTO voice_onboarding_events (id, onboarding_id, milestone, occurred_at)
       VALUES (?, ?, ?, ?) ON CONFLICT (onboarding_id, milestone) DO NOTHING`,
      [crypto.randomUUID(), id, milestone, Date.now()],
    );
  }

  async listMilestones(id: string): Promise<OnboardingMilestoneEvent[]> {
    return this.db.all<OnboardingMilestoneEvent>(
      "SELECT milestone, occurred_at FROM voice_onboarding_events WHERE onboarding_id = ?",
      [id],
    );
  }
}
