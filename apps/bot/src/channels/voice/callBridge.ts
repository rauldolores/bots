/**
 * Qué necesita el gateway de un puente de llamada, sin importar quién ponga la
 * voz.
 *
 * Existe para poder probar ElevenLabs contra OpenAI Realtime EN EL MISMO NÚMERO:
 * no hay un segundo número donde aislar la prueba, así que la única forma
 * honesta de comparar es que convivan y que producción no pueda romperse. La
 * decisión de cuál usar es por LLAMADA (ver elegirProveedorDeVoz), no por
 * despliegue.
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

export type VoiceProvider = "openai" | "elevenlabs";

/** Normaliza a solo dígitos para comparar teléfonos escritos de mil maneras. */
function soloDigitos(s: string): string {
  return s.replace(/\D/g, "");
}

/**
 * Qué proveedor atiende ESTA llamada.
 *
 * Por número de quien llama, no por bot ni por despliegue. Con un solo número
 * de teléfono disponible, es la única forma de probar el proveedor nuevo con
 * llamadas reales sin arriesgar las de clientes: quien no esté en la lista de
 * prueba ni se entera de que existe otra opción.
 *
 * La comparación es por los últimos 10 dígitos para no pelearse con el lada
 * internacional: "+52 1 55 1234 5678", "5215512345678" y "5512345678" son la
 * misma persona marcando desde el mismo teléfono.
 */
export function elegirProveedorDeVoz(listaCruda: string | undefined, callerId: string): VoiceProvider {
  const lista = (listaCruda ?? "")
    .split(",")
    .map((n) => soloDigitos(n))
    .filter(Boolean);
  if (lista.length === 0) return "openai";

  const quienLlama = soloDigitos(callerId);
  if (!quienLlama) return "openai";

  const cola = (n: string) => n.slice(-10);
  return lista.some((n) => cola(n) === cola(quienLlama)) ? "elevenlabs" : "openai";
}

/**
 * Lo que ElevenLabs necesita para atender ESTA llamada, salido de la pantalla
 * de configuración — no del entorno del servidor.
 *
 * Devuelve null si falta cualquier pieza: sin llave, sin agente o sin la
 * persona en la lista de prueba, la llamada es de OpenAI y punto.
 */
export async function credencialesElevenLabs(
  db: Db,
  botId: string,
  callerId: string,
  env: Env,
): Promise<{ apiKey: string; agentId: string } | null> {
  const settings = await new SettingsRepo(db, botId).all();
  if (elegirProveedorDeVoz(settings[SETTING_KEYS.voiceElevenLabsBetaCallers], callerId) !== "elevenlabs") {
    return null;
  }
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
  if (voiceId) {
    const [{ asegurarAgenteAlDia }, { buildTools }, { loadMcpTools }] = await Promise.all([
      import("./elevenlabsSetup"),
      import("../../tools"),
      import("../../tools/mcpTools"),
    ]);
    // Las MISMAS tools del camino de texto. Solo se usan sus esquemas aquí —
    // la ejecución vive en el puente, con el execute() de siempre.
    //
    // Las de MCP van INCLUIDAS: ElevenLabs solo puede llamar a lo que está
    // registrado en el agente, así que dejarlas fuera las volvía invisibles —
    // se cargaban en cada llamada y el agente nunca sabía que existían. Es una
    // consulta más al guardar o cuando cambia la configuración, no en cada
    // llamada, y loadMcpTools ya trae su propio cortacircuitos por si un
    // servidor MCP no responde.
    const mcp = await loadMcpTools(env, db, botId).catch(() => ({}));
    const tools = { ...buildTools({ env, botId, getConversationId: () => null }), ...mcp };
    const r = await asegurarAgenteAlDia(db, botId, apiKey, voiceId, tools).catch(() => ({
      actualizado: false,
      error: "no se pudo verificar",
    }));
    if (r.error) console.warn(`[voice-elevenlabs] agente posiblemente desactualizado: ${r.error}`);
  }

  // Se relee DESPUÉS de la actualización: si el agente se acababa de crear,
  // el id existe apenas ahora.
  const agentId = (await new SettingsRepo(db, botId).get(SETTING_KEYS.voiceElevenLabsAgentId))?.trim();
  if (!agentId) return null;
  return { apiKey, agentId };
}
