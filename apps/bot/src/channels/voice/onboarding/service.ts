// Orquestación del flujo de onboarding (F7 fase 8) — compone
// VoiceOnboardingsRepo + VoiceNumbersRepo (fase 7). Es la capa que llama el
// panel de /admin; los repos se quedan enfocados en su propia tabla.
import type { Env } from "../../../env";
import { Db } from "../../../db/client";
import { VoiceNumbersRepo } from "../../../db/voiceNumbers";
import {
  VoiceOnboardingsRepo,
  ONBOARDING_MILESTONES,
  type OnboardingMilestone,
  type VoiceOnboardingRow,
} from "../../../db/voiceOnboardings";

export interface StartOnboardingResult {
  ok: boolean;
  error?: string;
  onboarding?: VoiceOnboardingRow;
}

/**
 * Items 1-3 del flujo: recibe el número actual del cliente y le asigna,
 * automáticamente, el número de Twilio que el bot YA conectó en
 * /admin/conexiones (F7 fase 7) como destino del desvío. NO se provisiona
 * un número nuevo aquí (fuera de alcance de esta fase) — si el bot todavía
 * no conectó ninguno, se le pide hacerlo primero.
 */
export async function startOnboarding(env: Env, botId: string, sourcePhoneNumber: string): Promise<StartOnboardingResult> {
  const clean = sourcePhoneNumber.trim();
  if (!clean) return { ok: false, error: "Falta tu número actual." };

  const db = new Db(env.DB);
  const onboardings = new VoiceOnboardingsRepo(db);

  const existing = await onboardings.getActiveForBot(botId);
  if (existing) return { ok: false, error: "Ya tienes una conexión de número en curso — revísala abajo antes de crear otra." };

  const numbers = await new VoiceNumbersRepo(db).listByBot(botId);
  const destination = numbers.find((n) => n.enabled)?.phone_number ?? null;
  if (!destination) {
    return {
      ok: false,
      error: "Primero conecta un número de Twilio en Conexiones — ese es el número al que vamos a desviar tus llamadas.",
    };
  }

  const onboarding = await onboardings.create({ botId, sourcePhoneNumber: clean, destinationPhoneNumber: destination });
  return { ok: true, onboarding };
}

/** Item 8: el cliente ya vio el diagnóstico en verde y confirma — el agente queda activo para esa línea. */
export async function activateOnboarding(env: Env, botId: string, id: string): Promise<boolean> {
  const db = new Db(env.DB);
  const repo = new VoiceOnboardingsRepo(db);
  await repo.activate(id, botId);
  const row = await repo.getById(id);
  return row?.status === "active";
}

export async function disableOnboarding(env: Env, botId: string, id: string): Promise<void> {
  await new VoiceOnboardingsRepo(new Db(env.DB)).disable(id, botId);
}

export async function markOnboardingFailed(env: Env, botId: string, id: string): Promise<void> {
  await new VoiceOnboardingsRepo(new Db(env.DB)).markFailed(id, botId);
}

/** La llamada de prueba nunca llegó (o el cliente cambió de opinión) — reintentar sin perder el número de origen ni tener que reconectar Twilio de nuevo. */
export async function retryOnboarding(env: Env, botId: string, id: string): Promise<boolean> {
  const row = await new VoiceOnboardingsRepo(new Db(env.DB)).retry(id, botId);
  return row != null;
}

export interface OnboardingDiagnostics {
  onboarding: VoiceOnboardingRow | null;
  /** Timestamp de cuándo se alcanzó cada hito, o null si todavía no. Mismo orden que ONBOARDING_MILESTONES. */
  milestones: Record<OnboardingMilestone, number | null>;
}

/** Lo que pinta la pantalla de diagnóstico — el onboarding en curso de este bot (o el más reciente, si ya no queda ninguno activo) más sus hitos alcanzados. */
export async function getOnboardingDiagnostics(env: Env, botId: string): Promise<OnboardingDiagnostics> {
  const db = new Db(env.DB);
  const onboardings = new VoiceOnboardingsRepo(db);
  const onboarding = (await onboardings.getActiveForBot(botId)) ?? (await onboardings.getLatestForBot(botId));

  const milestones = Object.fromEntries(ONBOARDING_MILESTONES.map((m) => [m, null])) as Record<OnboardingMilestone, number | null>;
  if (onboarding) {
    for (const e of await onboardings.listMilestones(onboarding.id)) milestones[e.milestone] = e.occurred_at;
  }
  return { onboarding, milestones };
}
