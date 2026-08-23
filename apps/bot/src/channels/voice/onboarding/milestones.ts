// Engancha los 7 hitos de la pantalla de diagnóstico (F7 fase 8) a puntos
// del ciclo de vida de una llamada que YA EXISTEN (webhook, gateway, puente
// de Realtime) — no le agrega lógica nueva a ninguno de esos flujos: si no
// hay un onboarding en curso para este bot, esto es un no-op barato (una
// consulta indexada) y NUNCA tumba una llamada real, ni siquiera si algo
// aquí adentro fallara.
import type { Env } from "../../../env";
import { Db } from "../../../db/client";
import { VoiceOnboardingsRepo, type OnboardingMilestone } from "../../../db/voiceOnboardings";

export async function recordOnboardingMilestones(
  env: Env,
  botId: string,
  milestones: OnboardingMilestone[],
  opts?: { callSid?: string },
): Promise<void> {
  try {
    const db = new Db(env.DB);
    const repo = new VoiceOnboardingsRepo(db);
    const onboarding = await repo.findObservable(botId);
    if (!onboarding) return;

    for (const m of milestones) await repo.recordMilestone(onboarding.id, m);

    // Items 6/7 del flujo: la llamada de prueba se detectó — confirma la
    // conexión. Solo aplica una vez (markConnected ya es idempotente por
    // status='testing'; en 'connected' este bloque simplemente no hace nada).
    if (milestones.includes("call_received") && opts?.callSid && onboarding.status === "testing") {
      await repo.markConnected(onboarding.id, opts.callSid);
    }
  } catch (e) {
    console.error("[voice-onboarding] no se pudo registrar el hito de diagnóstico:", e);
  }
}
