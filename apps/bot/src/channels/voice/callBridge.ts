/**
 * Qué necesita el gateway de un puente de llamada.
 *
 * La interfaz nació para que ElevenLabs y OpenAI Realtime convivieran mientras
 * se comparaban en el mismo número. Esa comparación ya terminó —Realtime no
 * resolvía lo que este producto necesita— y hoy ElevenLabs es el único
 * proveedor de voz. La interfaz se conserva de todos modos: es lo que hace que
 * cambiar de proveedor sea un archivo nuevo y no una cirugía del gateway.
 */
import type { Env } from "../../env";
import type { Db } from "../../db/client";
import { SettingsRepo, SETTING_KEYS } from "../../db/settings";
import type { VoiceSession } from "./session";

export interface CallBridgeDeps {
  env: Env;
  botId: string;
  callerId: string;
  callSid: string;
  streamSid: string;
  voiceSession: VoiceSession;
  /** Inyectado por el gateway — ya sabe a qué WebSocket/llamada mandar. */
  sendToTwilio: (json: string) => void;
}

/** Lo único que el gateway le pide a un puente. Nada más de esto es público. */
export interface CallBridge {
  handleTwilioMedia(payloadBase64: string): void;
  handleTwilioDtmf(digit: string): void;
  close(reason: string): Promise<void>;
}

/**
 * Lo que ElevenLabs necesita para atender ESTA llamada, salido de la pantalla
 * de configuración — no del entorno del servidor.
 *
 * ElevenLabs es el ÚNICO proveedor de voz. Antes convivía con OpenAI Realtime
 * y se elegía por número de quien llamaba (una lista de prueba), porque había
 * un solo teléfono y era la única forma honesta de comparar sin arriesgar
 * llamadas de clientes. La comparación terminó: Realtime no resolvía lo que
 * este producto necesita, y mantener dos caminos costaba el doble de arreglos
 * y confundía la configuración.
 *
 * Devuelve null si falta la llave o el agente. Sin eso NO hay a qué conectarse
 * y la llamada no se puede atender: ya no existe un segundo proveedor donde
 * caerse, así que el gateway lo dice claro en vez de fingir que hay plan B.
 */
export async function credencialesElevenLabs(
  db: Db,
  botId: string,
  env: Env,
): Promise<{ apiKey: string; agentId: string } | null> {
  const settings = await new SettingsRepo(db, botId).allWithSecrets();
  const apiKey = settings[SETTING_KEYS.voiceElevenLabsApiKey]?.trim();
  if (!apiKey) return null;

  // El agente en ElevenLabs se actualiza SOLO si el código cambió algo suyo
  // desde la última vez (voz, modelo, formato de audio). En el caso normal
  // esto es una comparación de textos en memoria y no toca la red.
  //
  // Existe porque pasó lo contrario: se corrigieron el formato de audio y el
  // LLM del agente, se desplegó, y el agente del dueño se quedó con la
  // configuración vieja — porque solo se actualizaba al guardar la pantalla, y
  // nadie le dijo que tenía que volver a guardarla. Estuvo probando llamadas
  // contra un arreglo que ya existía pero no había llegado a su agente.
  const voiceId = settings[SETTING_KEYS.voiceElevenLabsVoiceId]?.trim();
  // Ya lo trae el all() de arriba — leerlo otra vez era una consulta de más en
  // el camino crítico.
  const agenteExistente = settings[SETTING_KEYS.voiceElevenLabsAgentId]?.trim();

  if (voiceId) {
    const { asegurarAgenteAlDia } = await import("./elevenlabsSetup");
    // Las MISMAS tools del camino de texto. Solo se usan sus esquemas aquí —
    // la ejecución vive en el puente, con el execute() de siempre.
    //
    // Las de MCP van INCLUIDAS: ElevenLabs solo puede llamar a lo que está
    // registrado en el agente, así que dejarlas fuera las volvía invisibles —
    // se cargaban en cada llamada y el agente nunca sabía que existían. Es una
    // consulta más al guardar o cuando cambia la configuración, no en cada
    // llamada, y loadMcpTools ya trae su propio cortacircuitos por si un
    // servidor MCP no responde.
    // Se pasa como FUNCIÓN, no como valor ya calculado: en el caso normal la
    // huella del agente coincide y no hay nada que actualizar, así que esto no
    // llega a ejecutarse. Antes se armaba siempre —consultando los servidores
    // MCP— en pleno camino crítico de una llamada entrante, para casi siempre
    // tirar el resultado; era el cliente quien pagaba esa espera en silencio.
    const revisar = () =>
      asegurarAgenteAlDia(db, botId, apiKey, voiceId, async () => {
        const [{ buildTools }, { loadMcpTools }] = await Promise.all([
          import("../../tools"),
          import("../../tools/mcpTools"),
        ]);
        const mcp = await loadMcpTools(env, db, botId).catch(() => ({}));
        return { ...buildTools({ env, botId, getConversationId: () => null }), ...mcp };
      }).catch(() => ({ actualizado: false, error: "no se pudo verificar" }));

    if (agenteExistente) {
      // El agente YA existe y atiende: revisarlo puede esperar. Antes esto se
      // esperaba antes de contestar, y cuando la revisión no terminaba limpia
      // se repetía en CADA llamada — medido en producción: ~9 segundos de
      // silencio por llamada porque una sola tool no se registraba (su huella
      // no se guarda si falta alguna, a propósito, para reintentarla).
      //
      // Reintentar está bien; cobrárselo a quien llama, no. Se lanza sin
      // esperar: la corrección llega igual, al agente de la llamada siguiente.
      void revisar().then((r) => {
        if (r.error) console.warn(`[voice-elevenlabs] agente posiblemente desactualizado: ${r.error}`);
      });
    } else {
      // Sin agente no hay a qué conectarse: aquí sí hay que esperar.
      const r = await revisar();
      if (r.error) console.warn(`[voice-elevenlabs] agente posiblemente desactualizado: ${r.error}`);
      const recienCreado = (await new SettingsRepo(db, botId).get(SETTING_KEYS.voiceElevenLabsAgentId))?.trim();
      return recienCreado ? { apiKey, agentId: recienCreado } : null;
    }
  }

  if (!agenteExistente) return null;
  return { apiKey, agentId: agenteExistente };
}
