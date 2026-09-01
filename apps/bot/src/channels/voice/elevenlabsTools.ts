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
  /** Si es false, el agente sigue hablando sin esperar el resultado. */
  expects_response: boolean;
  parameters: unknown;
}

const ESQUEMA_VACIO = { type: "object", properties: {} };

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
    // true SIEMPRE: el agente tiene que esperar el resultado para poder
    // contárselo al cliente. Sin esto diría "ya te agendé" antes de saber si
    // se agendó — exactamente la clase de mentira que este proyecto evita.
    expects_response: true,
    parameters,
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
): Promise<{ ids: Record<string, string>; error?: string }> {
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
      // Una herramienta que no se pudo registrar NO tumba a las demás: es
      // mejor un agente con cinco herramientas que uno con ninguna.
      console.error(`[voice-elevenlabs] no se registró la tool "${nombre}": ${res.status}`);
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

  if (Object.keys(ids).length === 0 && Object.keys(tools).length > 0) {
    return { ids, error: "No se pudo registrar ninguna herramienta en ElevenLabs." };
  }
  return { ids };
}
