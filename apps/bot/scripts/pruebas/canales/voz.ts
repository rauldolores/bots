// Voz: una llamada sin teléfono. Se arma el MISMO puente que atiende una
// llamada real (ElevenLabsCallBridge): el mismo prompt, el mismo saludo, las
// mismas herramientas ejecutadas aquí contra la base. Lo único distinto es
// que el cliente "habla" por texto (user_message) en vez de por audio, y que
// el audio del agente no va a ningún lado.
//
// Necesita la llave de ElevenLabs, que vive en el servidor de voz (Fly) o en
// la configuración del bot. Donde no está, el canal se reporta como omitido.
import { Db } from "../../../src/db/client";
import { ElevenLabsCallBridge } from "../../../src/channels/voice/elevenlabsBridge";
import { credencialesElevenLabs } from "../../../src/channels/voice/callBridge";
import { VoiceSession } from "../../../src/channels/voice/session";
import type { AdaptadorCanal, SesionCanal } from "../tipos";
import { conversacionPor, esperarRespuestaEnBase } from "./comun";

export const voz: AdaptadorCanal = {
  canal: "voz",
  async disponible(env, botId) {
    const db = new Db(env.DB);
    const canal = await db.first<{ n: number }>(
      "SELECT COUNT(*) AS n FROM bot_channels WHERE bot_id = ? AND channel = 'voice' AND enabled = true",
      [botId],
    );
    if (!Number(canal?.n ?? 0)) return "La voz no está conectada en este bot.";
    const creds = await credencialesElevenLabs(db, botId, env).catch(() => null);
    return creds ? null : "No hay llave de ElevenLabs en este entorno (corre las pruebas de voz en el servidor de voz).";
  },
  async abrir({ env, botId, runId, identidad }): Promise<SesionCanal> {
    const db = new Db(env.DB);
    // Un número que no puede ser de nadie: 555-0100 a 0199 están reservados para ficción.
    const callerId = `+1555010${String(Math.floor(Math.random() * 90) + 10)}`;
    const creds = (await credencialesElevenLabs(db, botId, env))!;
    const voiceSession = await VoiceSession.start(env, {
      tenantId: botId,
      callerId,
      provider: "twilio",
      providerCallId: `prueba-${runId}`,
      displayName: undefined,
    });
    const vistos = new Set<string>();
    const conv = () => conversacionPor(env, botId, "voice", callerId);
    const bridge = await ElevenLabsCallBridge.start(
      {
        env,
        botId,
        callerId,
        callSid: `prueba-${runId}-${identidad.nombre.split(" ")[0]}`,
        streamSid: `prueba-${runId}`,
        voiceSession,
        sendToTwilio: () => {},
      },
      creds,
    );
    const esperar = () => esperarRespuestaEnBase(env, botId, conv, vistos, { timeoutMs: 60_000, silencioMs: 5_000 });

    return {
      saludo: esperar,
      async enviar(texto) {
        bridge.enviarTextoDelCliente(texto);
        return esperar();
      },
      conversacionId: conv,
      async cerrar() {
        await bridge.close("prueba terminada");
      },
      marcas: () => ({ channel: "voice", channelUserId: callerId }),
    };
  },
};
