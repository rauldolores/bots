// El webhook HTTP que Twilio llama cuando entra una llamada de voz —
// POST /webhooks/voice/:botId (ver app.ts). A diferencia del resto del canal
// Voice, esto SÍ es portable (Node/Cloudflare/Vercel): es un webhook normal
// de request/respuesta, igual que /webhooks/telegram/:botId — no necesita el
// WebSocket todavía, solo devuelve el TwiML que le dice a Twilio adónde
// conectarlo (eso ya sí es Node-only, ver gateway.ts).
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { BotsRepo } from "../../db/bots";
import { BotChannelsRepo } from "../../db/botChannels";
import { VoiceNumbersRepo } from "../../db/voiceNumbers";
import { resolveChannelEnv } from "../effectiveEnv";
import { validateTwilioSignature } from "./twilioSignature";
import { signStreamToken } from "./streamToken";
import { buildConnectStreamTwiml } from "./twiml";
import { logVoiceEvent, maskId } from "./log";
import { recordOnboardingMilestones } from "./onboarding/milestones";

/** El token del stream solo necesita vivir hasta que Twilio abra el WebSocket (segundos después de este webhook) — 5 min de margen sobra y mantiene la ventana de ataque corta. */
const STREAM_TOKEN_TTL_MS = 5 * 60_000;

function toWsUrl(httpBaseUrl: string): string {
  return httpBaseUrl.replace(/^http/, "ws"); // http→ws, https→wss
}

/**
 * El TwiML de "conecta esta llamada a nuestro WebSocket" — lo usa tanto la
 * llamada entrante normal (abajo) como la recuperación tras una
 * transferencia fallida (F7 fase 9, ver transfer.ts): mismo mecanismo,
 * mismo token firmado, para que gateway.ts no tenga que distinguir de dónde
 * vino la conexión.
 */
export function buildStreamConnectResponse(
  rawEnv: Env,
  authToken: string,
  input: { botId: string; callSid: string; from: string; to: string },
): Promise<Response> {
  return (async () => {
    const base = (rawEnv.DASHBOARD_BASE_URL ?? "").replace(/\/$/, "");
    const exp = Date.now() + STREAM_TOKEN_TTL_MS;
    const tokenPayload = { botId: input.botId, callSid: input.callSid, from: input.from, to: input.to, exp: String(exp) };
    const token = await signStreamToken(authToken, tokenPayload);

    const streamUrl =
      `${toWsUrl(base)}/webhooks/voice/${input.botId}/stream` +
      `?callSid=${encodeURIComponent(input.callSid)}&from=${encodeURIComponent(input.from)}&to=${encodeURIComponent(input.to)}` +
      `&exp=${exp}&t=${token}`;

    return new Response(buildConnectStreamTwiml(streamUrl), { status: 200, headers: { "Content-Type": "text/xml" } });
  })();
}

export async function handleIncomingVoiceCall(request: Request, rawEnv: Env, botId: string): Promise<Response> {
  const db = new Db(rawEnv.DB);
  const bot = await new BotsRepo(db).getById(botId);
  if (!bot) {
    logVoiceEvent("webhook_reject", { botId, reason: "bot_not_found" });
    return new Response("bot not found", { status: 404 });
  }
  // F7 fase 7 — "tenant deshabilitado": un bot pausado no debe seguir
  // recibiendo llamadas nuevas, igual que ya no procesa mensajes de texto.
  if (bot.paused) {
    logVoiceEvent("webhook_reject", { botId, reason: "tenant_paused" });
    return new Response("tenant disabled", { status: 404 });
  }

  // F7 fase 7 — "agente (canal Voice) deshabilitado": a diferencia de
  // resolveChannelEnv() de abajo (que cae al env del despliegue si el bot
  // nunca conectó el canal, para no romper despliegues de un solo bot),
  // AQUÍ se exige una conexión explícita — sin esta fila, ni siquiera se
  // intenta con el TWILIO_AUTH_TOKEN del despliegue.
  const channelRow = await new BotChannelsRepo(db).getByBotAndChannel(botId, "voice");
  if (!channelRow) {
    logVoiceEvent("webhook_reject", { botId, reason: "voice_channel_disabled" });
    return new Response("voice channel not connected", { status: 404 });
  }

  // El token DE ESTE bot para el canal "voice" (Vault) — ya sabemos que la
  // fila existe (arriba), esto solo resuelve el secreto real + el SID/número
  // no-secretos de su config.
  const env = await resolveChannelEnv(rawEnv, botId, "voice");
  const authToken = env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    logVoiceEvent("webhook_reject", { botId, reason: "not_configured" });
    return new Response("voice channel not configured", { status: 404 });
  }

  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = String(v);

  const accountSid = params.AccountSid ?? "";
  const callSid = params.CallSid ?? "";
  const from = (params.From ?? "").trim();
  const to = (params.To ?? "").trim();

  // Defensa en profundidad: si este bot tiene un AccountSid configurado,
  // la llamada tiene que venir de ESA cuenta — no solo traer cualquier
  // firma válida calculada con el Auth Token correcto.
  if (env.TWILIO_ACCOUNT_SID && accountSid !== env.TWILIO_ACCOUNT_SID) {
    logVoiceEvent("webhook_reject", { botId, callSid: maskId(callSid), reason: "account_mismatch" });
    return new Response("forbidden", { status: 403 });
  }

  // La URL para la firma es la CONFIGURADA (DASHBOARD_BASE_URL + path), no
  // request.url — un proxy/balanceador puede reescribirla y descuadrar el
  // cálculo aunque la llamada sea legítima.
  const base = (rawEnv.DASHBOARD_BASE_URL ?? "").replace(/\/$/, "");
  const canonicalUrl = `${base}/webhooks/voice/${botId}`;
  const signature = request.headers.get("X-Twilio-Signature");
  const validSig = await validateTwilioSignature(authToken, canonicalUrl, params, signature);
  if (!validSig) {
    logVoiceEvent("webhook_reject", { botId, callSid: maskId(callSid), reason: "bad_signature" });
    return new Response("forbidden", { status: 403 });
  }

  // F7 fase 7 — resolución multi-tenant real: el número MARCADO (To) tiene
  // que estar registrado, habilitado, y pertenecer a ESTE bot. Nunca se
  // confía en el :botId de la URL a solas — es exactamente la validación de
  // "identificar llamadas entrantes" + "número sin tenant"/"número
  // duplicado" del enunciado, contra configuración persistente (voice_numbers).
  const numberRow = await new VoiceNumbersRepo(db).findByNumber("twilio", to);
  if (!numberRow) {
    logVoiceEvent("webhook_reject", { botId, callSid: maskId(callSid), reason: "number_not_registered" });
    return new Response("number not registered", { status: 404 });
  }
  if (!numberRow.enabled) {
    logVoiceEvent("webhook_reject", { botId, callSid: maskId(callSid), reason: "number_disabled" });
    return new Response("number disabled", { status: 404 });
  }
  if (numberRow.bot_id !== botId) {
    logVoiceEvent("webhook_reject", { botId, callSid: maskId(callSid), reason: "number_tenant_mismatch" });
    return new Response("forbidden", { status: 403 });
  }

  // F7 fase 8 — items 6/7 del onboarding "conecta tu número existente": si
  // hay un onboarding esperando su llamada de prueba para este bot, esta ES
  // esa llamada. No-op silencioso si no hay ninguno en curso.
  await recordOnboardingMilestones(env, botId, ["number_detected", "call_received"], { callSid });

  logVoiceEvent("webhook_call", { botId, callSid: maskId(callSid), from: maskId(from) });

  return buildStreamConnectResponse(rawEnv, authToken, { botId, callSid, from, to });
}
