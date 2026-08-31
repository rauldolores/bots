// El "Voice Gateway": el servidor WebSocket de Media Streams que Twilio abre
// UNA vez por llamada (bidireccional, ver twiml.ts). Solo corre bajo el
// runtime Node (runtime/node.ts) — es la única de las 3 plataformas
// soportadas con un proceso de larga vida capaz de sostener un WebSocket
// (ver la auditoría de arquitectura de voz, Sección F: en Cloudflare
// requeriría Durable Objects y en Vercel serverless no aplica tal cual;
// ninguno de los dos está implementado en esta fase).
//
// Cada conexión tiene su propio estado (GatewayCallState) guardado en un Map
// indexado por el WebSocket mismo, y su propio RealtimeCallBridge — nada de
// estado global mutable, así que N llamadas simultáneas no comparten nada
// entre sí sin necesitar ningún candado.
//
// F7 fase 3: el audio entrante/saliente ya corre por OpenAI Realtime
// (realtimeBridge.ts) — este archivo solo traduce el protocolo de Twilio
// (JSON por WebSocket) hacia/desde el puente, nunca decodifica el audio ni
// piensa la respuesta.
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { WebSocketServer, type WebSocket, type RawData } from "ws";
import type { Env } from "../../env";
import { resolveChannelEnv } from "../effectiveEnv";
import { verifyStreamToken } from "./streamToken";
import { parseTwilioStreamEvent } from "./mediaStreamProtocol";
import { VoiceChannel } from "./channel";
import { RealtimeCallBridge } from "./realtimeBridge";
import { ElevenLabsCallBridge } from "./elevenlabsBridge";
import { elegirProveedorDeVoz, type CallBridge } from "./callBridge";
import { logVoiceEvent, maskId } from "./log";
import { recordOnboardingMilestones } from "./onboarding/milestones";

const STREAM_PATH_RE = /^\/webhooks\/voice\/([^/]+)\/stream$/;

interface GatewayCallState {
  botId: string;
  callSid: string;
  from: string;
  to: string;
  streamSid: string | null;
  bridge: CallBridge | null;
  /** Recién en `true` tras verificar el token del evento "start" — ver authorizeStreamStart(). */
  authorized: boolean;
}

export interface VoiceGatewayHandle {
  /** Llamadas con un WebSocket abierto ahora mismo — para observabilidad y para probar aislamiento entre llamadas simultáneas. */
  activeCallCount(): number;
}

/** Lo mínimo que necesitamos del servidor HTTP — no importamos el tipo nominal de `http.Server` para no depender de qué devuelva exactamente `@hono/node-server`, solo de que tenga `.on("upgrade", ...)` como cualquier servidor Node. */
interface UpgradeCapableServer {
  on(event: "upgrade", listener: (req: IncomingMessage, socket: Socket, head: Buffer) => void): unknown;
}

/**
 * Cuelga el Voice Gateway del servidor HTTP ya en marcha. Se llama UNA vez,
 * al arrancar el proceso (ver runtime/node.ts).
 */
export function attachVoiceGateway(httpServer: UpgradeCapableServer, env: Env): VoiceGatewayHandle {
  const wss = new WebSocketServer({ noServer: true });
  const activeCalls = new Map<WebSocket, GatewayCallState>();

  httpServer.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(req.url ?? "", "http://internal");
    const match = STREAM_PATH_RE.exec(url.pathname);
    if (!match) return; // no es la ruta del Voice Gateway — no la tocamos

    // Twilio no manda el query string al abrir el WebSocket (confirmado en
    // producción), así que aquí ya no hay nada que autorizar todavía — el
    // token viaja en <Parameter> y llega recién con el evento "start" (ver
    // handleMessage). El upgrade se acepta para CUALQUIER ruta con forma
    // válida; quien no mande un "start" con token válido nunca consigue que
    // se cree una sesión ni un bridge, y se cierra de inmediato.
    const botId = match[1];
    wss.handleUpgrade(req, socket, head, (ws) => {
      const state: GatewayCallState = { botId, callSid: "", from: "", to: "", streamSid: null, bridge: null, authorized: false };
      activeCalls.set(ws, state);
      logVoiceEvent("gateway_connected", { botId, callSid: maskId(null), activeCalls: activeCalls.size });
      wireConnection(ws, state, env, activeCalls);
    });
  });

  return { activeCallCount: () => activeCalls.size };
}

/**
 * Twilio no firma el WebSocket (solo el webhook HTTP) — este token de
 * streamToken.ts es lo único que impide que cualquiera se conecte directo.
 * Se llama con los `customParameters` del evento "start", que es lo único
 * que Twilio sí entrega (ver nota en el `upgrade` handler más arriba).
 */
async function authorizeStreamStart(
  rawEnv: Env,
  payload: { botId: string; callSid: string; from: string; to: string; exp: string },
  token: string,
): Promise<boolean> {
  const expNum = Number(payload.exp);
  if (!payload.botId || !payload.callSid || !Number.isFinite(expNum) || Date.now() > expNum) return false;
  const env = await resolveChannelEnv(rawEnv, payload.botId, "voice");
  const authToken = env.TWILIO_AUTH_TOKEN;
  if (!authToken) return false;
  return verifyStreamToken(authToken, payload, token);
}

function wireConnection(
  ws: WebSocket,
  state: GatewayCallState,
  env: Env,
  activeCalls: Map<WebSocket, GatewayCallState>,
): void {
  ws.on("message", (raw: RawData) => {
    void handleMessage(ws, state, env, raw).catch((e) => {
      console.error("[voice-gateway] message handling failed:", e);
    });
  });

  ws.on("close", () => {
    void (async () => {
      if (state.bridge) {
        try {
          await state.bridge.close("websocket_closed");
        } catch (e) {
          console.error("[voice-gateway] bridge close() failed on ws close:", e);
        }
      }
      activeCalls.delete(ws);
      logVoiceEvent("gateway_closed", { botId: state.botId, callSid: maskId(state.callSid), activeCalls: activeCalls.size });
    })();
  });

  ws.on("error", (e: Error) => {
    console.error("[voice-gateway] ws error:", e.message);
  });
}

async function handleMessage(ws: WebSocket, state: GatewayCallState, env: Env, raw: RawData): Promise<void> {
  const msg = parseTwilioStreamEvent(raw.toString());
  if (!msg) {
    logVoiceEvent("gateway_bad_message", { botId: state.botId, callSid: maskId(state.callSid) });
    return;
  }

  switch (msg.event) {
    case "connected":
      logVoiceEvent("gateway_protocol_connected", { botId: state.botId, protocol: msg.protocol, version: msg.version });
      return;

    case "start": {
      // El token/callSid/from/to firmados viajan en customParameters (ver
      // twiml.ts) — el query string de la URL nunca le llega al gateway
      // (Twilio no lo preserva). Sin un "start" autorizado no hay sesión ni
      // bridge: se cierra la conexión aquí mismo.
      const custom = msg.start.customParameters ?? {};
      const authPayload = {
        botId: state.botId,
        callSid: custom.callSid ?? "",
        from: custom.from ?? "",
        to: custom.to ?? "",
        exp: custom.exp ?? "",
      };
      const ok = await authorizeStreamStart(env, authPayload, custom.t ?? "");
      if (!ok) {
        logVoiceEvent("gateway_reject", { botId: state.botId, callSid: maskId(null), reason: "invalid_or_expired_token" });
        ws.close(1008, "unauthorized");
        return;
      }
      state.authorized = true;
      state.callSid = authPayload.callSid;
      state.from = authPayload.from;
      state.to = authPayload.to;
      // F7 fase 8: el Media Stream de Twilio ya conectó Y quedó autorizado.
      void recordOnboardingMilestones(env, state.botId, ["twilio_connected"]);

      // Local, no state.streamSid: la propiedad es string|null y TS no la
      // estrecha de forma confiable a través de los await de abajo.
      const streamSid = msg.start.streamSid;
      state.streamSid = streamSid;
      logVoiceEvent("gateway_start", {
        botId: state.botId,
        callSid: maskId(msg.start.callSid),
        streamSid: maskId(streamSid),
        encoding: msg.start.mediaFormat?.encoding,
        sampleRate: msg.start.mediaFormat?.sampleRate,
      });
      try {
        const voiceChannel = new VoiceChannel(env);
        const voiceSession = await voiceChannel.startSession({
          tenantId: state.botId,
          callerId: state.from || msg.start.callSid,
          provider: "twilio",
          providerCallId: msg.start.callSid,
          calledNumber: state.to || null,
        });
        // F7 fase 8: el tenant quedó resuelto (agente identificado) y la
        // fila de voice_sessions ya existe.
        await recordOnboardingMilestones(env, state.botId, ["agent_identified", "voice_session_created"]);
        // F7 fase 7, item 9: el StreamSid solo se conoce hasta este evento
        // "start" — la fila de voice_sessions ya existe (arriba), así que se
        // completa aparte en vez de bloquear la creación de la sesión por él.
        await voiceSession.setStreamSid(streamSid).catch((e) => {
          console.error("[voice-gateway] no se pudo guardar el streamSid:", e);
        });
        // Aquí es donde se conecta el Agent Core existente (vía
        // buildAgentContext dentro del puente) con el proveedor de voz —
        // nada de esto reimplementa tools/RAG/system prompt.
        //
        // Quién atiende se decide POR LLAMADA, según el teléfono de quien
        // marca: es la única forma de probar ElevenLabs con llamadas reales
        // teniendo un solo número. Sin lista de prueba configurada, esto es
        // siempre "openai" y el código de abajo es el de siempre.
        const callerId = state.from || msg.start.callSid;
        const proveedor = elegirProveedorDeVoz(env, callerId);
        const deps = {
          env,
          botId: state.botId,
          callerId,
          callSid: msg.start.callSid,
          streamSid,
          voiceSession,
          sendToTwilio: (json: string) => ws.send(json),
        };
        if (proveedor === "elevenlabs") {
          logVoiceEvent("proveedor_beta", {
            botId: state.botId,
            callSid: maskId(state.callSid),
            proveedor,
          });
          try {
            state.bridge = await ElevenLabsCallBridge.start(deps);
          } catch (e) {
            // La prueba NUNCA puede tumbar una llamada real: si ElevenLabs no
            // conecta, se atiende con OpenAI como cualquier otra. Quien llama
            // no se entera de que había un experimento de por medio.
            console.error("[voice-gateway] ElevenLabs falló, se cae a OpenAI:", e);
            logVoiceEvent("proveedor_beta_fallback", {
              botId: state.botId,
              callSid: maskId(state.callSid),
            });
            state.bridge = await RealtimeCallBridge.start(deps);
          }
        } else {
          state.bridge = await RealtimeCallBridge.start(deps);
        }
      } catch (e) {
        console.error("[voice-gateway] no se pudo iniciar la llamada:", e);
      }
      return;
    }

    case "media":
      state.bridge?.handleTwilioMedia(msg.media.payload);
      return;

    case "dtmf":
      state.bridge?.handleTwilioDtmf(msg.dtmf.digit);
      return;

    case "mark":
      logVoiceEvent("gateway_mark", { botId: state.botId, callSid: maskId(state.callSid), name: msg.mark.name });
      return;

    case "stop":
      logVoiceEvent("gateway_stop", { botId: state.botId, callSid: maskId(state.callSid) });
      if (state.bridge) {
        try {
          await state.bridge.close("call_stopped");
        } catch (e) {
          console.error("[voice-gateway] bridge close() failed on stop:", e);
        }
      }
      return;
  }
}
