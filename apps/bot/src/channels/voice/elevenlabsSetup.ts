/**
 * Dejar listo ElevenLabs desde la PANTALLA, sin que el dueño toque un servidor.
 *
 * Lo único que se le pide es su llave y qué voz quiere. El agente en ElevenLabs
 * —con su formato de audio, su modelo y su voz— lo crea y lo mantiene este
 * archivo contra su API. Pedirle un "Agent ID" habría sido trasladarle un
 * concepto técnico que no tiene por qué conocer, y que además se configura mal
 * con facilidad: basta equivocarse en el formato de audio para que la llamada
 * se oiga a ruido.
 */
import type { Db } from "../../db/client";
import { SettingsRepo, SETTING_KEYS } from "../../db/settings";

const API = "https://api.elevenlabs.io/v1";

/**
 * μ-law 8 kHz es el formato de Twilio. Si esto no coincide, la llamada se oye
 * como estática — no como un error, que es lo que lo hace difícil de
 * diagnosticar. Por eso lo fija el sistema y no es configurable.
 */
const FORMATO_TELEFONIA = "ulaw_8000";
/** Flash v2.5: ~75 ms de inferencia. En una llamada, la latencia se oye. */
const MODELO_TTS = "eleven_flash_v2_5";

export interface VozDisponible {
  voiceId: string;
  nombre: string;
}

/** Las voces que el dueño ve en el selector. */
export interface OpcionDeVoz {
  value: string;
  label: string;
}

/**
 * Catálogo en español, curado a propósito.
 *
 * ElevenLabs tiene miles de voces y la mayoría son en inglés o suenan con
 * acento marcado al hablar español. Mostrarlas todas sería darle al dueño un
 * problema en vez de una opción. Las etiquetas describen cómo suenan, no cómo
 * se llaman: "voz femenina, mexicana" le dice mucho más que "Maya".
 *
 * Que una voz exista en el catálogo NO garantiza que la cuenta del dueño la
 * tenga — por eso se valida contra su cuenta al guardar (ver vocesDisponibles).
 */
export const VOCES_ELEVENLABS: OpcionDeVoz[] = [
  { value: "nbcvT3C2tyOd2OsRAtUf", label: "Femenina — mexicana, cercana" },
  { value: "IOyj8WtBHdke2FjQgGAr", label: "Femenina — colombiana, clara" },
  { value: "x5IDPSl4ZUbhosMmVFTk", label: "Femenina — neutra, natural" },
  { value: "57D8YIbQSuE3REDPO6Vm", label: "Masculina — colombiana, formal" },
  { value: "6NviSCQ9jcQTnryEFRc1", label: "Masculina — rioplatense, versátil" },
  { value: "a4Rnq6xoXLwW9h60Ay5h", label: "Masculina — neutra, serena" },
];

export const VOZ_POR_DEFECTO = VOCES_ELEVENLABS[0].value;

/** Las voces que la cuenta de ESTA llave puede usar de verdad. */
export async function vocesDisponibles(apiKey: string): Promise<Set<string>> {
  const res = await fetch(`${API}/voices`, { headers: { "xi-api-key": apiKey } });
  if (!res.ok) throw new Error(`ElevenLabs rechazó la llave (${res.status})`);
  const body = (await res.json()) as { voices?: { voice_id?: string }[] };
  return new Set((body.voices ?? []).map((v) => v.voice_id).filter(Boolean) as string[]);
}

interface ResultadoSetup {
  ok: boolean;
  error?: string;
  agentId?: string;
}

/**
 * Crea (o actualiza) el agente de ElevenLabs de este bot y guarda su id.
 *
 * Se llama al guardar la configuración, no al recibir la llamada: si la llave
 * está mal o la voz no está en la cuenta, el dueño se entera EN LA PANTALLA,
 * con un mensaje que puede accionar — y no descubriéndolo con un cliente al
 * teléfono.
 */
export async function prepararAgenteElevenLabs(
  db: Db,
  botId: string,
  apiKey: string,
  voiceId: string,
): Promise<ResultadoSetup> {
  const repo = new SettingsRepo(db, botId);

  let disponibles: Set<string>;
  try {
    disponibles = await vocesDisponibles(apiKey);
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
  if (disponibles.size > 0 && !disponibles.has(voiceId)) {
    return {
      ok: false,
      error:
        "Esa voz no está disponible en tu cuenta de ElevenLabs. Agrégala a tu biblioteca desde su sitio y vuelve a guardar.",
    };
  }

  // El prompt real se manda por conversación (ver elevenlabsBridge.ts), así que
  // aquí va uno mínimo: lo que importa de esta llamada es fijar voz, modelo y
  // formato de audio.
  const cuerpo = {
    name: `Nodia — ${botId.slice(0, 8)}`,
    conversation_config: {
      agent: { prompt: { prompt: "Asistente telefónico." } },
      tts: { voice_id: voiceId, model_id: MODELO_TTS, agent_output_audio_format: FORMATO_TELEFONIA },
    },
  };

  const existente = (await repo.get(SETTING_KEYS.voiceElevenLabsAgentId))?.trim();
  const url = existente ? `${API}/convai/agents/${encodeURIComponent(existente)}` : `${API}/convai/agents/create`;
  const res = await fetch(url, {
    method: existente ? "PATCH" : "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });

  if (!res.ok) {
    // Si el agente guardado ya no existe (lo borraron desde ElevenLabs), se
    // crea uno nuevo en vez de dejar la configuración rota para siempre.
    if (existente && res.status === 404) {
      await repo.set(SETTING_KEYS.voiceElevenLabsAgentId, "");
      return prepararAgenteElevenLabs(db, botId, apiKey, voiceId);
    }
    return { ok: false, error: `ElevenLabs respondió ${res.status}: ${(await res.text()).slice(0, 160)}` };
  }

  const body = (await res.json()) as { agent_id?: string };
  const agentId = body.agent_id ?? existente;
  if (!agentId) return { ok: false, error: "ElevenLabs no devolvió el identificador del agente." };

  await repo.set(SETTING_KEYS.voiceElevenLabsAgentId, agentId);
  return { ok: true, agentId };
}
