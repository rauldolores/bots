// Punto de entrada del canal Voice — el equivalente conceptual al "adapter"
// de Telegram/Twilio/Meta (channels/shared.ts), pero para un transporte en
// vivo en vez de un webhook de una sola pasada: por eso NO implementa
// ChannelAdapter literal (parseIncoming(Request)/sendReply() asumen un ciclo
// petición/respuesta HTTP que una llamada telefónica no tiene — ver la
// auditoría, Sección D). Lo que sí comparte con esos adapters es el rol:
// resolver tenant, mantener la identidad de la conversación y ser la única
// puerta de este canal hacia el Agent Core.
//
// Fase 1 (F7): sin Twilio ni WebSockets de audio todavía. Esto es solo la
// arquitectura interna — resolver tenant + arrancar/cerrar sesiones sobre el
// Agent Core existente.
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { BotsRepo, type Bot } from "../../db/bots";
import { VoiceSessionsRepo } from "../../db/voiceSessions";
import { VoiceSession } from "./session";
import { toVoiceCallContext } from "./types";
import type { StartVoiceSessionInput, VoiceCallContext } from "./types";

export class VoiceChannel {
  constructor(private readonly rawEnv: Env) {}

  /**
   * Resuelve el tenant (bot) — mismo patrón que /webhooks/<canal>/:botId en
   * app.ts: valida contra la tabla `bots` en vez de asumir que el tenantId
   * que trae la señal (URL, header, lo que sea en la fase de Twilio) es de
   * fiar. Null si no existe.
   */
  async resolveTenant(tenantId: string): Promise<Bot | null> {
    const db = new Db(this.rawEnv.DB);
    return new BotsRepo(db).getById(tenantId);
  }

  /**
   * Arranca una llamada para un tenant ya identificado. Falla fuerte si el
   * tenant no existe — igual que routeToAgent() en app.ts devuelve 404 en
   * vez de crear una conversación huérfana bajo un bot_id que no es de nadie.
   */
  async startSession(input: StartVoiceSessionInput): Promise<VoiceSession> {
    const bot = await this.resolveTenant(input.tenantId);
    if (!bot) {
      throw new Error(`voice: no existe el bot ${input.tenantId}`);
    }
    return VoiceSession.start(this.rawEnv, input);
  }

  /** Consulta el contexto de una llamada ya existente por su id interno (voice_sessions.id) — para logs, panel, o para retomar una sesión desde otra capa (p. ej. el handler de Twilio en la fase de integración). */
  async getContext(tenantId: string, callId: string): Promise<VoiceCallContext | null> {
    const db = new Db(this.rawEnv.DB);
    const row = await new VoiceSessionsRepo(db, tenantId).getById(callId);
    return row ? toVoiceCallContext(row) : null;
  }
}
