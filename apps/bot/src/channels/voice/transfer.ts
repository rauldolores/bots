// F7 fase 9: transferencia de llamada a un humano — el lado de telefonía
// (TwiML de <Dial>, la llamada REST a Twilio para redirigir la llamada en
// vivo, y el webhook que Twilio llama con el resultado del intento). La
// DECISIÓN de transferir vive en el Agent Core (tool transfer_to_human);
// esto es solo el mecanismo de Twilio para llevarla a cabo.
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { BotsRepo } from "../../db/bots";
import { BotChannelsRepo } from "../../db/botChannels";
import { VoiceSessionsRepo } from "../../db/voiceSessions";
import { resolveChannelEnv } from "../effectiveEnv";
import { validateTwilioSignature } from "./twilioSignature";
import { buildStreamConnectResponse } from "./webhook";
import { logVoiceEvent, maskId } from "./log";
import { recordCallEvent } from "./events";

/** Cuánto suena el lado del humano antes de darlo por "no contestó" — igual que cualquier conmutador telefónico normal. */
const TRANSFER_DIAL_TIMEOUT_S = 20;

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** El TwiML que redirige la llamada EN VIVO hacia el humano — `action` es adónde Twilio reporta cómo terminó ese intento (contestó, ocupado, no contestó, falló). */
export function buildTransferTwiml(destinationNumber: string, statusCallbackUrl: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Dial timeout="${TRANSFER_DIAL_TIMEOUT_S}" action="${escapeXml(statusCallbackUrl)}" method="POST">` +
    `${escapeXml(destinationNumber)}</Dial></Response>`
  );
}

export interface TransferRestResult {
  ok: boolean;
  error?: string;
}

/**
 * Redirige una llamada QUE YA ESTÁ EN VIVO hacia el TwiML de transferencia —
 * la API de Twilio para "cambiarle a esta llamada lo que está haciendo
 * ahora mismo". Mismo patrón de auth/fetch que ya usa handoffHuman.ts para
 * mandar plantillas de WhatsApp (Basic sid:token, x-www-form-urlencoded) —
 * no se inventa un cliente nuevo.
 */
export async function redirectLiveCall(
  creds: { accountSid: string; authToken: string },
  callSid: string,
  twiml: string,
): Promise<TransferRestResult> {
  try {
    const auth = btoa(`${creds.accountSid}:${creds.authToken}`);
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Calls/${callSid}.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ Twiml: twiml }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `twilio ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Los estados de Twilio que cuentan como "sí conectó" vs las formas de fallar que hay que manejar (número ocupado, timeout, y cualquier otro fallo). */
const DIAL_FAILURE_REASON: Record<string, string> = {
  busy: "busy",
  "no-answer": "no_answer",
  failed: "failed",
  canceled: "canceled",
};

/**
 * POST /webhooks/voice/:botId/transfer-status — a dónde apunta `action` del
 * <Dial> de arriba. Si el humano SÍ contestó, la llamada ya terminó del
 * lado del cliente cuando cuelgan — se cierra limpio. Si NO contestó
 * (ocupado/timeout/falló), aquí es donde "la IA recupera la conversación":
 * se reconecta al mismo mecanismo de siempre (buildStreamConnectResponse),
 * mismo botId/callSid, así que retoma la MISMA conversación/memoria.
 */
export async function handleTransferStatusCallback(request: Request, rawEnv: Env, botId: string): Promise<Response> {
  const db = new Db(rawEnv.DB);
  const bot = await new BotsRepo(db).getById(botId);
  if (!bot) return new Response("bot not found", { status: 404 });

  const channelRow = await new BotChannelsRepo(db).getByBotAndChannel(botId, "voice");
  if (!channelRow) return new Response("voice channel not connected", { status: 404 });

  const env = await resolveChannelEnv(rawEnv, botId, "voice");
  const authToken = env.TWILIO_AUTH_TOKEN;
  if (!authToken) return new Response("voice channel not configured", { status: 404 });

  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = String(v);

  const base = (rawEnv.DASHBOARD_BASE_URL ?? "").replace(/\/$/, "");
  const canonicalUrl = `${base}/webhooks/voice/${botId}/transfer-status`;
  const signature = request.headers.get("X-Twilio-Signature");
  const validSig = await validateTwilioSignature(authToken, canonicalUrl, params, signature);
  if (!validSig) {
    logVoiceEvent("webhook_reject", { botId, reason: "bad_signature_transfer_status" });
    return new Response("forbidden", { status: 403 });
  }

  const callSid = params.CallSid ?? "";
  const from = (params.From ?? "").trim();
  const to = (params.To ?? "").trim();
  const dialCallStatus = (params.DialCallStatus ?? "").trim();

  // F7 fase 10: esta llamada de dominio ocurre en un proceso/request
  // completamente aparte del RealtimeCallBridge que la pidió — solo se
  // conoce el CallSid, así que la fila se busca por ahí, no por su id interno.
  const sessionsRepo = new VoiceSessionsRepo(db, botId);
  const callRow = await sessionsRepo.getByProviderCallId(callSid);

  if (dialCallStatus === "completed") {
    logVoiceEvent("transfer_completed", { botId, callSid: maskId(callSid) });
    if (callRow) {
      await sessionsRepo.setTransferStatus(callRow.id, "completed");
      await recordCallEvent(db, botId, callRow.id, "call.transferred", { phase: "completed" });
    }
    return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`, {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }

  const reason = DIAL_FAILURE_REASON[dialCallStatus] ?? dialCallStatus ?? "unknown";
  logVoiceEvent("transfer_failed", { botId, callSid: maskId(callSid), reason });
  if (callRow) {
    await sessionsRepo.setTransferStatus(callRow.id, "failed");
    await recordCallEvent(db, botId, callRow.id, "call.transferred", { phase: "failed", reason });
  }

  // La IA recupera la conversación: mismo mecanismo que una llamada entrante
  // normal, mismo botId/callSid — el cliente nunca se entera de que hubo un
  // intento de transferencia fallido, solo sigue hablando con el agente.
  return buildStreamConnectResponse(rawEnv, authToken, { botId, callSid, from, to });
}
