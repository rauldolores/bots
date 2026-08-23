// F7 fase 10: el registro de eventos de dominio de una llamada — el punto
// único que webhook.ts/gateway.ts/realtimeBridge.ts/transfer.ts usan para
// dejar constancia de call.started/answered/user_turn/agent_turn/
// tool_called/interrupted/transferred/ended. Nunca truena hacia el
// llamador: un fallo al escribir el log de observabilidad no debe cortar
// una llamada real, igual que onboarding/milestones.ts.
import { Db } from "../../db/client";
import { VoiceCallEventsRepo, type VoiceCallEventType } from "../../db/voiceCallEvents";

export async function recordCallEvent(
  db: Db,
  botId: string,
  callId: string,
  type: VoiceCallEventType,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    await new VoiceCallEventsRepo(db).record({ botId, callId, type, payload });
  } catch (e) {
    console.error(`[voice-events] no se pudo registrar "${type}":`, e);
  }
}
