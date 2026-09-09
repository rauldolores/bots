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
/** El cerebro que genera las respuestas — separado del modelo de VOZ (MODELO_TTS). */
const MODELO_LLM = "gpt-4.1-mini";

/**
 * Tope duro de duración, en segundos — el mismo que ya aplica el puente de
 * OpenAI (30 min).
 *
 * ElevenLabs cobra POR MINUTO, así que una llamada que se quede colgada es
 * dinero corriendo. Su default son 10 minutos; aquí se alinea con el tope que
 * este proyecto ya usa, para que las dos rutas de voz se comporten igual y
 * ninguna pueda gastar más que la otra por un descuido de configuración.
 */
const MAX_DURACION_SEG = 30 * 60;

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
 * Catálogo de voces MEXICANAS, curado a propósito.
 *
 * ElevenLabs tiene 107 voces con acento mexicano solo en español, y miles en
 * total. Mostrarlas todas sería darle al dueño un problema en vez de una
 * opción: nadie escucha cien muestras para elegir una. Estas se eligieron de
 * esa lista con un criterio concreto —que suenen bien al TELÉFONO en una
 * conversación de ventas, no narrando un audiolibro— y quedaron balanceadas
 * entre voces de mujer y de hombre.
 *
 * Las etiquetas describen cómo SUENAN, no cómo se llaman: "mujer, cálida y
 * cercana" le dice al dueño mucho más que "Fernanda". El nombre real de
 * ElevenLabs se conserva entre paréntesis solo para poder rastrearla.
 *
 * Que una voz exista aquí NO garantiza que la cuenta del dueño la tenga — son
 * voces de la biblioteca compartida y se agregan solas al guardar (ver
 * vocesDisponibles y agregarVozCompartida).
 */
export const VOCES_ELEVENLABS: OpcionDeVoz[] = [
  // La que este despliegue venía usando. Va primera y NO se quita: si
  // desapareciera del catálogo, el bot que ya la tiene guardada se quedaría
  // con un id que el selector no reconoce.
  { value: "nbcvT3C2tyOd2OsRAtUf", label: "Mujer — cercana y natural (la de siempre)" },

  { value: "ewn5JTa3lNPY8QVuZJi6", label: "Mujer — conversacional, acento neutro (Ana Sofía)" },
  { value: "9Godp7dNohUvXk6qp0gS", label: "Mujer — joven y amable, tipo centro de contacto (Regina)" },
  { value: "NyQ87MpRGbszyh7rZLXM", label: "Mujer — cálida y clara (Fernanda)" },
  { value: "xTNZKgOQwmwWXcrmZIca", label: "Mujer — profesional y confiable (Saya)" },
  { value: "sORJQTBm9rUDnyKe7RpG", label: "Mujer — ejecutiva y amable (Erika)" },
  { value: "iOeCMakiJ4CctfQaM9yd", label: "Mujer — cordial, de todos los días (Marisol)" },

  { value: "iKVy5pslTv9psldEFn41", label: "Hombre — claro y profesional, acento neutro (Diego)" },
  { value: "L8yclR0Szq6ZIMSK6iXo", label: "Hombre — ejecutivo, acento chilango (Juan)" },
  { value: "HS7W0ly7cmPolP5WMyz9", label: "Hombre — cálido y conversacional (Carlos Garza)" },
  { value: "7EmI9SPdwF8NyYuIn2Vh", label: "Hombre — tranquilo y bien modulado (Sergio López)" },
  { value: "77K94gl6ZCRVTHG8Gi1w", label: "Hombre — cercano y fácil de seguir (Patricio)" },
  { value: "9gm2jXcKEKzgaypKoOlk", label: "Hombre — grave y seguro (Alejandro García)" },
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
  /** Las tools del Agent Core — sin ellas el agente habla pero no puede HACER nada. */
  tools?: Record<string, any>,
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

  // Las herramientas se registran como entidades aparte en ElevenLabs y el
  // agente las referencia por id. Sin esto el agente conversa igual de bien
  // pero no puede agendar, capturar un lead ni consultar la base de
  // conocimiento — que fue justo lo que se descubrió en una llamada real:
  // "le pedí que me agendara y no pudo".
  let toolIds: string[] = [];
  let faltaronHerramientas = false;

  // SIN argumento de herramientas significa "no las toques", NO "quítaselas
  // todas". La diferencia importa: el guardado del panel llama aquí sin
  // pasarlas, y como el cuerpo manda `tool_ids` siempre, mandar [] le borraba
  // al agente sus 12 herramientas en cada guardado — quedaba hablando pero
  // sin poder agendar, capturar un lead ni consultar el CRM. Se recuperaba
  // solo en la siguiente llamada (asegurarAgenteAlDia veía la huella
  // distinta), así que el daño era invisible salvo para quien llamara justo
  // en medio. La huella de producción lo delataba: "tools:" vacío con 12
  // herramientas guardadas.
  //
  // Un mapa VACÍO sí es una orden explícita de dejarlo sin ninguna (el dueño
  // las apagó todas en /admin/agente), y por eso se distingue de `undefined`.
  if (tools === undefined) {
    toolIds = Object.values(leerMapa(await repo.get(SETTING_KEYS.voiceElevenLabsToolIds)));
  } else if (Object.keys(tools).length > 0) {
    const { registrarHerramientas } = await import("./elevenlabsTools");
    const previos = leerMapa(await repo.get(SETTING_KEYS.voiceElevenLabsToolIds));
    const r = await registrarHerramientas(apiKey, tools, previos);
    if (r.error) return { ok: false, error: r.error };
    await repo.set(SETTING_KEYS.voiceElevenLabsToolIds, JSON.stringify(r.ids));
    toolIds = Object.values(r.ids);
    faltaronHerramientas = r.faltantes.length > 0;
    if (faltaronHerramientas) {
      console.error(`[voice-elevenlabs] herramientas sin registrar: ${r.faltantes.join(", ")}`);
    }
  }

  // El prompt real se manda por conversación (ver elevenlabsBridge.ts), así que
  // aquí va uno mínimo: lo que importa de esta llamada es fijar voz, modelo y
  // formato de audio.
  const cuerpo = {
    name: `Nodia — ${botId.slice(0, 8)}`,
    // Los overrides vienen APAGADOS por defecto en cada agente nuevo — medida
    // de seguridad de ElevenLabs para que un cliente cualquiera no pueda
    // hacer que el agente diga cosas que su dueño no autorizó. Sin esto,
    // ElevenLabs corta la conexión en cuanto elevenlabsBridge.ts manda el
    // prompt real de la conversación (conversation_config_override): pasó en
    // producción — la llamada conectaba pero se quedaba muda, sin un solo
    // segundo de audio, porque el cierre llegaba antes de que hubiera algo
    // que decir. El prompt real SÍ tiene que mandarse por conversación (es el
    // mismo Agent Core que usa OpenAI, con la memoria de ESE cliente) — el
    // valor de aquí abajo es solo el default si algún día se conecta sin
    // pasar por el puente.
    platform_settings: {
      overrides: {
        conversation_config_override: {
          agent: { first_message: true, prompt: { prompt: true } },
        },
      },
    },
    conversation_config: {
      // Sin esto, ElevenLabs asume inglés — y su validación NO deja usar
      // Flash v2.5 en un agente en inglés (solo v2/turbo). Pasó en producción:
      // "English Agents must use turbo or flash v2", con un agente que solo
      // va a hablar español. Todo lo que arma este archivo es en español, así
      // que se declara, en vez de dejarlo a lo que ElevenLabs adivine.
      // Sin decir qué LLM usar, ElevenLabs le asigna el que tenía por default
      // al crear el agente — y ese default puede quedar obsoleto con el
      // tiempo sin que nadie lo note (pasó: su panel marcó el agente con
      // "Update deprecated LLM" en cuanto se creó). "gpt-4o-mini" es la misma
      // familia que ya usa este proyecto como su nivel rápido/barato (ver
      // pricing.ts) — se declara a propósito, en vez de heredar lo que
      // ElevenLabs decida hoy.
      agent: {
        language: "es",
        prompt: { prompt: "Asistente telefónico.", llm: MODELO_LLM, tool_ids: toolIds },
      },
      tts: { voice_id: voiceId, model_id: MODELO_TTS, agent_output_audio_format: FORMATO_TELEFONIA },
      // El formato de SALIDA (arriba) y el de ENTRADA son campos separados —
      // se probó configurando solo el primero, y el resultado fue que la
      // conexión conectaba bien pero nadie se transcribía: ElevenLabs seguía
      // esperando el default (PCM) para lo que el cliente manda, y le llegaba
      // μ-law de Twilio sin avisar — audio irreconocible para su ASR. Sin este
      // campo, hablarle al bot no producía ni un solo user_transcript.
      asr: { user_input_audio_format: FORMATO_TELEFONIA },
      // Cobran por minuto: sin tope, una llamada olvidada sigue gastando.
      conversation: { max_duration_seconds: MAX_DURACION_SEG },
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
  // La huella SOLO se guarda si TODAS quedaron. Con una faltante se deja sin
  // guardar a propósito: así la próxima llamada vuelve a intentarlo y el
  // agente se completa solo en cuanto el problema se arregle. Antes se
  // guardaba pasara lo que pasara, y eso dejó al bot sin poder agendar
  // durante días — cada arreglo se desplegaba y nunca llegaba a aplicarse.
  if (!faltaronHerramientas) {
    await repo.set(SETTING_KEYS.voiceElevenLabsConfigHash, huellaDeConfiguracion(voiceId, toolIds));
  }
  return { ok: true, agentId };
}

/**
 * Con qué configuración quedó armado el agente en ElevenLabs.
 *
 * Sirve para saber si el agente que vive allá sigue coincidiendo con lo que
 * este código produce hoy. Pasó en producción: se corrigieron el formato de
 * audio y el LLM del agente, se desplegó, y el agente del dueño siguió con la
 * configuración vieja — porque solo se actualiza al guardar la pantalla, y a
 * nadie se le dijo que tenía que volver a guardarla. La llamada seguía muda
 * por un arreglo que ya estaba hecho.
 */
export function huellaDeConfiguracion(voiceId: string, toolIds: string[] = []): string {
  return [
    voiceId,
    MODELO_TTS,
    MODELO_LLM,
    FORMATO_TELEFONIA,
    `max:${MAX_DURACION_SEG}`,
    // Las herramientas entran en la huella: si el dueño enciende o apaga una
    // desde /admin/agente, el agente se actualiza solo en la próxima llamada.
    `tools:${[...toolIds].sort().join(",")}`,
    "overrides:v1",
    // La FORMA de las herramientas, no solo cuáles son.
    //
    // La huella listaba los ids y nada más, así que un cambio en cómo se
    // declara una herramienta —su esquema, su descripción, o algo tan
    // decisivo como `expects_response`— no la movía: el agente del dueño se
    // quedaba con la declaración vieja y no había forma de enterarse. Pasó
    // exactamente eso con `expects_response`, que estuvo en false durante
    // semanas. Subir este número obliga a volver a registrarlas una vez.
    "tools_shape:v2-expects-response",
  ].join("|");
}

/** Lee un mapa nombre→id guardado como JSON, tolerante a basura. */
function leerMapa(crudo: string | null | undefined): Record<string, string> {
  if (!crudo?.trim()) return {};
  try {
    const v = JSON.parse(crudo);
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/**
 * Se asegura de que el agente en ElevenLabs esté al día ANTES de la llamada.
 *
 * No hace nada en el caso normal (una comparación de textos en memoria); solo
 * cuando el código cambió algo del agente desde la última vez, lo actualiza.
 * Nunca lanza: si esto falla, la llamada sigue con lo que haya — es mejor un
 * agente desactualizado que ninguna llamada.
 */
export async function asegurarAgenteAlDia(
  db: Db,
  botId: string,
  apiKey: string,
  voiceId: string,
  /**
   * Las herramientas, o una función que las consigue.
   *
   * Se acepta la función a propósito: armarlas obliga a consultar los
   * servidores MCP, y eso son cientos de milisegundos EN MEDIO de una llamada
   * entrante, con el cliente escuchando silencio. Como el caso normal es que
   * la huella coincida y no haya nada que actualizar, ese trabajo se hacía
   * para tirarlo. Pasando una función, solo se paga cuando de verdad hay que
   * reconfigurar al agente.
   */
  tools?: Record<string, any> | (() => Promise<Record<string, any>>),
): Promise<{ actualizado: boolean; error?: string }> {
  const repo = new SettingsRepo(db, botId);
  const guardada = (await repo.get(SETTING_KEYS.voiceElevenLabsConfigHash))?.trim();
  const idsActuales = Object.values(leerMapa(await repo.get(SETTING_KEYS.voiceElevenLabsToolIds)));
  if (guardada === huellaDeConfiguracion(voiceId, idsActuales)) return { actualizado: false };

  const resueltas = typeof tools === "function" ? await tools() : tools;

  // Un agente NUNCA debe quedar con MENOS herramientas de las que ya tenía por
  // un tropiezo de red. Pasó exactamente eso al aplicar un cambio de modelo: el
  // servidor MCP no respondió a tiempo, se armó el conjunto sin sus 5
  // herramientas, y el agente se reescribió con 7 en vez de 12. Peor todavía:
  // como esas 7 sí se registraron, la huella se guardó y el sistema se quedó
  // convencido de estar al día — la degradación se volvía permanente y muda.
  //
  // No es un candado: quitar una herramienta a propósito desde el panel también
  // baja la cuenta. Solo se aborta ESTA pasada; la siguiente lo reintenta, y
  // como la huella no se guarda, converge en cuanto el conteo se estabilice.
  if (resueltas && idsActuales.length > 0 && Object.keys(resueltas).length < idsActuales.length) {
    return {
      actualizado: false,
      error:
        `se iban a registrar ${Object.keys(resueltas).length} herramientas y el agente ya tiene ` +
        `${idsActuales.length}; no se toca (probablemente un servidor MCP no respondió)`,
    };
  }

  const r = await prepararAgenteElevenLabs(db, botId, apiKey, voiceId, resueltas).catch((e) => ({
    ok: false as const,
    error: String((e as Error)?.message ?? e),
  }));
  return { actualizado: r.ok, error: r.ok ? undefined : r.error };
}

/**
 * La URL de la muestra de audio de una voz, resuelta EN VIVO.
 *
 * No se guarda en el catálogo a propósito: algunas muestras de ElevenLabs
 * vienen firmadas con una caducidad dentro de la propia URL, así que una
 * constante en el código dejaría de sonar sin que nadie lo notara hasta que el
 * dueño le picara. Resolverla al momento cuesta una consulta y no caduca nunca.
 *
 * Busca primero en la cuenta del dueño (donde vive la voz que ya usa) y
 * después en la biblioteca compartida (donde viven las que todavía no ha
 * elegido). Devuelve null si no aparece en ninguna: el panel lo trata como
 * "esta voz no se puede escuchar", no como un error de la pantalla.
 */
export async function urlDeMuestra(apiKey: string, voiceId: string): Promise<string | null> {
  try {
    const propias = await fetch(`${API}/voices`, { headers: { "xi-api-key": apiKey } });
    if (propias.ok) {
      const b = (await propias.json()) as { voices?: { voice_id?: string; preview_url?: string }[] };
      const mia = (b.voices ?? []).find((v) => v.voice_id === voiceId);
      if (mia?.preview_url) return mia.preview_url;
    }
  } catch {
    /* si la cuenta no responde, todavía queda la biblioteca compartida */
  }

  for (let page = 0; page < MAX_PAGINAS_BUSQUEDA; page++) {
    try {
      const res = await fetch(`${API}/shared-voices?language=es&page_size=100&page=${page}`, {
        headers: { "xi-api-key": apiKey },
      });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        voices?: { voice_id?: string; preview_url?: string }[];
        has_more?: boolean;
      };
      const hallada = (body.voices ?? []).find((v) => v.voice_id === voiceId);
      if (hallada?.preview_url) return hallada.preview_url;
      if (!body.has_more) break;
    } catch {
      return null;
    }
  }
  return null;
}
