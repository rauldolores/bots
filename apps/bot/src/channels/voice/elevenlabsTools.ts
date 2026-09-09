/**
 * Las herramientas del agente, registradas en ElevenLabs.
 *
 * Las mismas de siempre —searchKb, captureLead, scheduleAppointment,
 * catalogQuery, handoffHuman…— sin reimplementar ninguna: aquí solo viaja el
 * ESQUEMA (nombre, descripción, parámetros). La ejecución sigue siendo el
 * `execute()` del AI SDK dentro del puente, así que una cita agendada por
 * teléfono escribe en las mismas tablas que una agendada por WhatsApp.
 *
 * ElevenLabs no acepta herramientas escritas dentro del agente: hay que
 * crearlas como entidades con su propio id y luego referenciarlas en
 * `agent.prompt.tool_ids`. Por eso este archivo lleva la cuenta de qué id le
 * corresponde a cada nombre, y actualiza en vez de recrear — si no, cada
 * despliegue dejaría herramientas huérfanas acumulándose en la cuenta del
 * dueño.
 */
import { asSchema } from "ai";

const API = "https://api.elevenlabs.io/v1";

/** Lo que ElevenLabs guarda de una herramienta. */
interface ToolConfig {
  type: "client";
  name: string;
  description: string;
  parameters: unknown;
  /**
   * Que el agente ESPERE el resultado antes de seguir hablando.
   *
   * ElevenLabs lo deja en `false` por omisión, y ese default silencioso fue
   * el peor bug que ha tenido este canal. Con `false`, la herramienta se
   * dispara como un aviso: el modelo no recibe NUNCA lo que devolvió. El
   * puente hacía su parte —ejecutaba, distinguía el fallo del éxito y mandaba
   * `client_tool_result` con su `is_error` (ver elevenlabsClient.ts)— y
   * ElevenLabs tiraba esa respuesta a la basura.
   *
   * O sea que el agente literalmente NO PODÍA saber si algo se había
   * guardado, y para contestarle al cliente no le quedaba más que adivinar.
   * De ahí sale toda la familia de "me dijo que ya lo había hecho y no lo
   * hizo": no era un modelo mentiroso ni un prompt flojo — era que la única
   * fuente de verdad disponible se descartaba antes de llegarle. Ninguna
   * regla de prompt podía arreglar eso, y varias se escribieron intentándolo.
   */
  expects_response: boolean;
  /**
   * Cuánto espera ElevenLabs por esa respuesta. Va por encima del tope del
   * puente (TOOL_TIMEOUT_MS, 8s) a propósito: quien debe rendirse primero es
   * el puente, que sabe DECIR por qué falló. Si se rinde ElevenLabs, el
   * agente se queda sin resultado y volvemos a que adivine.
   */
  response_timeout_secs: number;
}

/** Ver `response_timeout_secs`: por encima de los 8s del puente. */
const ESPERA_RESULTADO_SEGS = 15;

const ESQUEMA_VACIO = { type: "object", properties: {} };

/** Lo único que ElevenLabs acepta dentro de una propiedad del esquema. */
const CAMPOS_DE_PROPIEDAD = ["type", "description", "enum", "items", "properties", "required"];

/**
 * Deja el JSON Schema con SOLO lo que ElevenLabs entiende.
 *
 * El que produce el AI SDK trae además `$schema` y `additionalProperties` —
 * legales en JSON Schema, pero su validador los rechaza y devuelve 422 sin
 * decir cuál campo le molestó. Se probó en producción: TODAS las herramientas
 * fallaron con 422 y el agente se quedó sin ninguna, así que confirmó una cita
 * que no podía agendar.
 *
 * Va recursivo porque un parámetro puede ser un objeto o un arreglo de
 * objetos, y ahí adentro vuelve a aparecer la misma basura.
 */
function limpiarEsquema(nodo: unknown): unknown {
  if (Array.isArray(nodo)) return nodo.map(limpiarEsquema);
  if (!nodo || typeof nodo !== "object") return nodo;

  const entrada = nodo as Record<string, unknown>;
  const salida: Record<string, unknown> = {};
  for (const clave of CAMPOS_DE_PROPIEDAD) {
    if (!(clave in entrada)) continue;
    if (clave === "properties" && entrada.properties && typeof entrada.properties === "object") {
      const props: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(entrada.properties as Record<string, unknown>)) {
        const limpia = limpiarEsquema(v) as Record<string, unknown>;
        // ElevenLabs EXIGE descripción en cada parámetro: sin ella responde
        // "Must set one of: description, dynamic_variable, is_system_provided,
        // constant_value, or is_omitted" y rechaza la herramienta ENTERA.
        // Varias tools tienen campos sin describir (notes, query…) porque para
        // los otros proveedores el nombre bastaba — y por uno solo se caían
        // las ocho, dejando al agente sin nada con qué trabajar.
        if (limpia && typeof limpia === "object" && !limpia.description) {
          limpia.description = k;
        }
        props[k] = limpia;
      }
      salida.properties = props;
    } else if (clave === "items") {
      salida.items = limpiarEsquema(entrada.items);
    } else {
      salida[clave] = entrada[clave];
    }
  }
  // El `type` es obligatorio y ElevenLabs lo usa como discriminador: si llega
  // ausente responde 422 con "Input tag 'None' ... does not match any of the
  // expected tags" y rechaza la herramienta ENTERA.
  //
  // Pasó con vinqulia_display_task_list, y salió caro por un camino indirecto:
  // como esa tool no se registraba, la huella de configuración no se guardaba
  // nunca (se guarda solo si TODAS quedaron), así que el agente se reconfiguraba
  // ENTERO en cada llamada entrante — unos 9 segundos de silencio para quien
  // llamaba, por un campo sin tipo dentro de un arreglo de objetos.
  //
  // Un union tipo ["string", "null"] tampoco le sirve: espera un tag único.
  if (Array.isArray(salida.type)) {
    salida.type = (salida.type as unknown[]).find((t) => t !== "null") ?? "string";
  }
  if (!salida.type) {
    // Se deduce por la forma; si no hay ninguna pista, "string" es la hoja más
    // segura — describe el dato sin prometer una estructura que no existe.
    salida.type = salida.properties ? "object" : salida.items ? "array" : "string";
  }
  return salida;
}

/** Convierte una tool del Agent Core al formato que espera ElevenLabs. */
async function aToolConfig(nombre: string, def: any): Promise<ToolConfig | null> {
  let parameters: unknown = ESQUEMA_VACIO;
  if (def?.inputSchema) {
    try {
      // Igual que realtimeTools.ts: asSchema normaliza Zod, jsonSchema() y
      // StandardSchema — las tools MCP no siempre son Zod.
      parameters = await asSchema(def.inputSchema).jsonSchema;
    } catch (e) {
      console.error(`[voice-elevenlabs] esquema inválido en la tool "${nombre}" — se omite:`, e);
      return null;
    }
  }
  return {
    type: "client",
    name: nombre,
    description: String(def?.description ?? ""),
    parameters: limpiarEsquema(parameters),
    expects_response: true,
    response_timeout_secs: ESPERA_RESULTADO_SEGS,
  };
}

/**
 * Deja registradas en ElevenLabs las herramientas de este bot y devuelve sus
 * ids, listos para `agent.prompt.tool_ids`.
 *
 * `idsPrevios` es el mapa nombre→id de la última vez: lo que ya existe se
 * ACTUALIZA (mismo id), lo nuevo se crea, y lo que ya no está se borra de la
 * cuenta del dueño en vez de quedarse ahí para siempre.
 */
export async function registrarHerramientas(
  apiKey: string,
  tools: Record<string, any>,
  idsPrevios: Record<string, string>,
): Promise<{ ids: Record<string, string>; faltantes: string[]; error?: string }> {
  const ids: Record<string, string> = {};
  const cabeceras = { "xi-api-key": apiKey, "Content-Type": "application/json" };

  for (const [nombre, def] of Object.entries(tools)) {
    const config = await aToolConfig(nombre, def);
    if (!config) continue;

    const idPrevio = idsPrevios[nombre];
    const res = await fetch(
      idPrevio ? `${API}/convai/tools/${encodeURIComponent(idPrevio)}` : `${API}/convai/tools`,
      { method: idPrevio ? "PATCH" : "POST", headers: cabeceras, body: JSON.stringify({ tool_config: config }) },
    );

    if (!res.ok) {
      // Si la herramienta guardada ya no existe (alguien la borró desde
      // ElevenLabs), se crea de nuevo en vez de dejar al agente sin ella.
      if (idPrevio && res.status === 404) {
        const nueva = await fetch(`${API}/convai/tools`, {
          method: "POST",
          headers: cabeceras,
          body: JSON.stringify({ tool_config: config }),
        });
        if (nueva.ok) {
          const cuerpo = (await nueva.json()) as { id?: string; tool_id?: string };
          const id = cuerpo.id ?? cuerpo.tool_id;
          if (id) ids[nombre] = id;
          continue;
        }
      }
      // El CUERPO del error, no solo el código: un 422 sin detalle no dice
      // qué campo le molestó, y eso costó una llamada real en la que el
      // agente se quedó sin ninguna herramienta.
      const detalle = await res.text().catch(() => "");
      console.error(
        `[voice-elevenlabs] no se registró la tool "${nombre}": ${res.status} ${detalle.slice(0, 300)}`,
      );
      // Una herramienta que no se pudo registrar NO tumba a las demás: es
      // mejor un agente con cinco herramientas que uno con ninguna.
      continue;
    }

    const cuerpo = (await res.json()) as { id?: string; tool_id?: string };
    const id = cuerpo.id ?? cuerpo.tool_id ?? idPrevio;
    if (id) ids[nombre] = id;
  }

  // Las que ya no están en el agente se borran de la cuenta — si no, cada
  // cambio de configuración dejaría basura acumulándose.
  for (const [nombre, id] of Object.entries(idsPrevios)) {
    if (ids[nombre]) continue;
    await fetch(`${API}/convai/tools/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "xi-api-key": apiKey },
    }).catch(() => {});
  }

  // Qué NO quedó. Se reporta aunque otras sí hayan entrado: tratar el éxito
  // parcial como éxito congeló el sistema en producción — entraron 5 de 11, se
  // guardó la huella como si todo hubiera salido bien, y desde entonces el
  // registro se saltaba. El agente se quedó sin scheduleAppointment ni
  // captureLead, y ningún arreglo posterior llegaba a aplicarse.
  const faltantes = Object.keys(tools).filter((n) => !ids[n]);

  if (Object.keys(ids).length === 0 && Object.keys(tools).length > 0) {
    return { ids, faltantes, error: "No se pudo registrar ninguna herramienta en ElevenLabs." };
  }
  return { ids, faltantes };
}
