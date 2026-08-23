// F7 fase 8: tipos del onboarding "conecta tu número existente" — la vista
// de TypeScript sobre voice_onboardings (snake_case) más el punto de
// extensión para agregar métodos nuevos (portabilidad, SIP/BYOC) sin tocar
// el Voice Agent Core.
import type { VoiceOnboardingMethod, VoiceOnboardingRow, VoiceOnboardingStatus } from "../../../db/voiceOnboardings";

export type { VoiceOnboardingMethod, VoiceOnboardingStatus };

/**
 * Igual que VoiceCallContext (types.ts de la fase 1): "agente" en este
 * producto ES el bot — tenantId/agentId se exponen como el MISMO bot_id,
 * nunca como dos columnas separadas en la base. El campo agentId existe
 * para que la interfaz sea explícita sobre qué representa, no porque haya
 * una resolución de agente distinta hoy.
 */
export interface VoiceOnboardingView {
  id: string;
  tenantId: string;
  agentId: string;
  method: VoiceOnboardingMethod;
  sourcePhoneNumber: string;
  destinationPhoneNumber: string | null;
  status: VoiceOnboardingStatus;
  verificationCallId: string | null;
  connectedAt: number | null;
  activatedAt: number | null;
  disabledAt: number | null;
  createdAt: number;
}

export function toVoiceOnboardingView(row: VoiceOnboardingRow): VoiceOnboardingView {
  return {
    id: row.id,
    tenantId: row.bot_id,
    agentId: row.bot_id,
    method: row.method,
    sourcePhoneNumber: row.source_phone_number,
    destinationPhoneNumber: row.destination_phone_number,
    status: row.status,
    verificationCallId: row.verification_call_id,
    connectedAt: row.connected_at,
    activatedAt: row.activated_at,
    disabledAt: row.disabled_at,
    createdAt: row.created_at,
  };
}

export interface OnboardingInstructionStep {
  title: string;
  detail: string;
}

export interface OnboardingInstructions {
  summary: string;
  steps: OnboardingInstructionStep[];
  /** Nota corta (reversibilidad, qué tan rápido aplica) — para no repetir el mismo texto en cada handler. */
  note?: string;
}

/**
 * El punto de extensión de esta fase: agregar portabilidad (LNP), SIP/BYOC,
 * u otro proveedor de telefonía significa implementar ESTA interfaz y
 * registrarla en registry.ts — nada más.
 *
 * Lo que NUNCA cambia al agregar un método nuevo:
 *   - La máquina de estados (pending→testing→connected→active, con
 *     failed/disabled) — vive en VoiceOnboardingsRepo, es la misma para
 *     cualquier método.
 *   - Cómo se identifica una llamada entrante ya conectada — sigue siendo
 *     voice_numbers (F7 fase 7): sin importar CÓMO llegó el desvío/la
 *     portabilidad/el SIP trunk, Twilio (u otro proveedor) igual entrega un
 *     número marcado, y ESE es el que resuelve tenant/agente.
 *   - El Voice Agent Core (agent/, tools/, realtimeBridge.ts) — un método
 *     nuevo solo cambia CÓMO se le explica al cliente que conecte su
 *     número, nunca qué pasa una vez que la llamada ya está conectada.
 *
 * Lo que SÍ puede diferir por método (no implementado todavía, documentado
 * para cuando haga falta):
 *   - Portabilidad/SIP no se verifican con una llamada de prueba inmediata
 *     como call_forwarding — son procesos asíncronos del lado del
 *     proveedor (días, no segundos). Ese método necesitaría su propio
 *     mecanismo para pasar de 'testing' a 'connected' (un webhook de estado
 *     del proveedor, o un polling) en vez de depender de markConnected()
 *     disparado por una llamada real — un método futuro de esta interfaz
 *     (ej. `checkProviderStatus()`) cubriría eso sin tocar los métodos que
 *     ya existen.
 */
export interface OnboardingMethodHandler {
  method: VoiceOnboardingMethod;
  /** Para mostrarlo en la UI antes de que el cliente elija (hoy solo hay una opción real). */
  label: string;
  description: string;
  buildInstructions(input: { sourcePhoneNumber: string; destinationPhoneNumber: string }): OnboardingInstructions;
}
