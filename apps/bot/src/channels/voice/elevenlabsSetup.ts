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

/**
 * Las voces que la cuenta de ESTA llave puede usar de verdad.
 *
 * Antes de llamar a la red: ElevenLabs muestra en su panel una lista de
 * llaves con un identificador junto a cada una, y el secreto real —el que
 * empieza con "sk_"— solo se ve completo al crearla o rotarla. Es fácil
 * copiar el identificador por error, y ElevenLabs lo rechaza con un mensaje
 * de error genérico (400) indistinguible de una llave revocada o mal tecleada
 * si no se lee el cuerpo de la respuesta. Pasó en producción: el dueño guardó
 * el identificador, la prueba nunca se activó, y el mensaje no explicaba qué
 * corregir.
 */
export async function vocesDisponibles(apiKey: string): Promise<Set<string>> {
  if (!apiKey.startsWith("sk_")) {
    throw new Error(
      'Esa no es la llave — es el identificador. En ElevenLabs, la llave de verdad empieza con "sk_" y solo se ve completa al crearla o rotarla (Perfil → API Keys). Crea una nueva o rota la que ya tienes y pega el valor que empiece con sk_.',
    );
  }
  const res = await fetch(`${API}/voices`, { headers: { "xi-api-key": apiKey } });
  if (!res.ok) {
    const detalle = await res
      .json()
      .then((b: any) => b?.detail?.message as string | undefined)
      .catch(() => undefined);
    throw new Error(detalle ?? `ElevenLabs rechazó la llave (${res.status}).`);
  }
  const body = (await res.json()) as { voices?: { voice_id?: string }[] };
  return new Set((body.voices ?? []).map((v) => v.voice_id).filter(Boolean) as string[]);
}

interface ResultadoSetup {
  ok: boolean;
  error?: string;
  agentId?: string;
}

/** Cuántas páginas de 100 se recorren buscando una voz — cubre 1000 antes de rendirse. */
const MAX_PAGINAS_BUSQUEDA = 10;

/**
 * Encuentra al dueño público de una voz compartida, buscando por su voice_id
 * en la biblioteca de ElevenLabs (filtrada a español).
 *
 * La API de "agregar a mi cuenta" pide voice_id Y public_owner_id juntos, pero
 * de una voz solo se conoce el primero — el catálogo de este archivo no guarda
 * el segundo porque cambiaría si ElevenLabs reorganiza su biblioteca, y
 * buscarlo en vivo es más robusto que confiar en un valor fijo de hace meses.
 */
async function buscarDuenoPublico(apiKey: string, voiceId: string): Promise<string | null> {
  for (let page = 0; page < MAX_PAGINAS_BUSQUEDA; page++) {
    const res = await fetch(`${API}/shared-voices?language=es&page_size=100&page=${page}`, {
      headers: { "xi-api-key": apiKey },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      voices?: { voice_id?: string; public_owner_id?: string }[];
      has_more?: boolean;
    };
    const hallada = (body.voices ?? []).find((v) => v.voice_id === voiceId);
    if (hallada?.public_owner_id) return hallada.public_owner_id;
    if (!body.has_more) break;
  }
  return null;
}

/**
 * Agrega una voz compartida a la biblioteca de la cuenta — el paso que en el
 * sitio de ElevenLabs es un botón "Add to my voices", hecho aquí sin que el
 * dueño lo toque.
 */
async function agregarVozCompartida(
  apiKey: string,
  publicOwnerId: string,
  voiceId: string,
  nombre: string,
): Promise<boolean> {
  const res = await fetch(
    `${API}/voices/add/${encodeURIComponent(publicOwnerId)}/${encodeURIComponent(voiceId)}`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ new_name: nombre }),
    },
  );
  return res.ok;
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
  // Las voces del catálogo son compartidas: viven en la biblioteca pública de
  // ElevenLabs, no en la cuenta del dueño hasta que alguien las agrega — el
  // mismo botón "Add to my voices" de su sitio. Antes esto se le pedía a mano
  // al dueño; ahora se hace solo, que es justo lo que "sin pasos técnicos"
  // significa.
  if (!disponibles.has(voiceId)) {
    const dueno = await buscarDuenoPublico(apiKey, voiceId);
    const agregada = dueno
      ? await agregarVozCompartida(apiKey, dueno, voiceId, `Nodia — ${voiceId.slice(0, 8)}`)
      : false;
    if (!agregada) {
      return {
        ok: false,
        error:
          "No se pudo agregar esa voz a tu cuenta de ElevenLabs automáticamente. Intenta con otra opción del catálogo.",
      };
    }
  }

  // El prompt real se manda por conversación (ver elevenlabsBridge.ts), así que
  // aquí va uno mínimo: lo que importa de esta llamada es fijar voz, modelo y
  // formato de audio.
  const cuerpo = {
    name: `Nodia — ${botId.slice(0, 8)}`,
    conversation_config: {
      // Sin esto, ElevenLabs asume inglés — y su validación NO deja usar
      // Flash v2.5 en un agente en inglés (solo v2/turbo). Pasó en producción:
      // "English Agents must use turbo or flash v2", con un agente que solo
      // va a hablar español. Todo lo que arma este archivo es en español, así
      // que se declara, en vez de dejarlo a lo que ElevenLabs adivine.
      agent: { language: "es", prompt: { prompt: "Asistente telefónico." } },
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
