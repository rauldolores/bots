import type { VoiceOnboardingMethod } from "../../../db/voiceOnboardings";
import type { OnboardingMethodHandler } from "./types";
import { callForwardingHandler } from "./methods/callForwarding";

/**
 * Registro de métodos de onboarding — agregar portabilidad o SIP/BYOC es
 * implementar OnboardingMethodHandler (ver types.ts) y sumarlo aquí. Nada
 * más en el sistema necesita saber qué métodos existen.
 */
export const ONBOARDING_METHODS: Partial<Record<VoiceOnboardingMethod, OnboardingMethodHandler>> = {
  call_forwarding: callForwardingHandler,
};

export function getOnboardingMethod(method: VoiceOnboardingMethod): OnboardingMethodHandler | null {
  return ONBOARDING_METHODS[method] ?? null;
}

export function listOnboardingMethods(): OnboardingMethodHandler[] {
  return Object.values(ONBOARDING_METHODS).filter((m): m is OnboardingMethodHandler => Boolean(m));
}
