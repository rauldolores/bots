// Quién es, en el CRM conectado por MCP, la persona que está escribiendo o
// llamando.
//
// Existe porque pedírselo al modelo no funcionó. Tres veces seguidas, con
// reglas cada vez más explícitas en el prompt, el agente escribió en el CRM
// con `id: 1` — un número puesto por poner, porque nadie le había dado el
// verdadero y buscarlo era un paso que se le olvidaba. El CRM rechazaba la
// nota y la tarea por clave foránea, y el cliente colgaba creyendo que
// habían quedado. El cliente SÍ estaba en el CRM: se encontraba por el mismo
// número desde el que llamaba.
//
// Así que el paso deja de ser una instrucción y pasa a ser código: lo
// buscamos nosotros ANTES de que empiece la conversación y le damos el id
// hecho. Si no aparece, el prompt lo dice en vez de callar — un hueco en el
// prompt es justo lo que el modelo rellena.
//
// Por correo primero y por teléfono después, y SOLO por esos dos: estos CRMs
// no indexan nombres, así que buscar "Federico Legarreta" devuelve "sin
// resultados" aunque Federico esté ahí.
import type { Env } from "../env";
import type { Db } from "../db/client";

/** Tope de la búsqueda. Corre antes de saludar: pasado esto, mejor sin id que con el cliente esperando. */
const TIMEOUT_MS = 2_500;

/**
 * Cuánto vale una resolución antes de volver a preguntarle al CRM.
 *
 * Diez minutos: más que una llamada, y si alguien dio de alta al contacto
 * mientras tanto, la siguiente conversación lo verá. Se cachea TAMBIÉN el
 * "no apareció" — repetir una búsqueda que ya sabemos vacía son dos viajes
 * al CRM por llamada, con el cliente esperando el saludo.
 */
const VIGENCIA_MS = 10 * 60_000;
const cache = new Map<string, { at: number; valor: ContactoResuelto | null }>();

/** Solo para pruebas y para cuando el dueño acaba de dar de alta a alguien. */
export function olvidarContactosMcp(): void {
  cache.clear();
}

/** Cómo se llama, en cualquier MCP, la herramienta que busca personas. */
const ES_BUSCAR_CONTACTOS = /(buscar|search|find|list)[_-]?(contacto|contact)s?$/i;

export interface ContactoResuelto {
  /** El id tal cual lo devolvió el CRM — puede ser número o texto según el sistema. */
  id: string;
  /** Cuántos coincidieron: con más de uno, el prompt avisa en vez de elegir a ciegas. */
  coincidencias: number;
}

/**
 * Busca a la persona en el MCP y devuelve su id.
 *
 * `null` = no hay MCP, no hay herramienta de búsqueda, o no apareció. Nunca
 * lanza: esto es una mejora del contexto, no la ruta crítica.
 */
export async function resolverContactoEnMcp(
  env: Env,
  db: Db,
  botId: string,
  quien: { email?: string | null; telefono?: string | null },
  /**
   * Las tools del MCP ya cargadas.
   *
   * Importa para el reloj: quien arma el contexto (agent/context.ts) ya las
   * cargó en la tanda anterior, y volver a pedirlas aquí reconecta con el
   * servidor MCP — medido en una llamada real, 3 segundos EXTRA antes del
   * saludo. Con ellas, esto es una ejecución y nada más.
   */
  toolsYaCargadas?: Record<string, unknown>,
): Promise<ContactoResuelto | null> {
  const email = (quien.email ?? "").trim();
  const telefono = (quien.telefono ?? "").trim();
  if (!email && !telefono) return null;

  const clave = `${botId}|${email}|${telefono}`;
  const enCache = cache.get(clave);
  if (enCache && Date.now() - enCache.at < VIGENCIA_MS) return enCache.valor;

  try {
    const tools = toolsYaCargadas ?? (await (await import("../tools/mcpTools")).loadMcpTools(env, db, botId));
    const nombre = Object.keys(tools).find((n) => ES_BUSCAR_CONTACTOS.test(n));
    if (!nombre) return null;
    const buscar = (tools as Record<string, { execute?: (args: unknown, opts: unknown) => Promise<unknown> }>)[nombre];
    if (!buscar?.execute) return null;

    // El correo primero: identifica a una persona mejor que un teléfono, que
    // puede ser el conmutador de una oficina y devolver a varios compañeros.
    for (const texto of [email, telefono].filter(Boolean)) {
      const hallado = await conTimeout(buscar.execute({ texto }, {}), TIMEOUT_MS).catch(() => null);
      const ids = idsDeLaRespuesta(hallado);
      if (ids.length > 0) {
        const valor = { id: ids[0], coincidencias: ids.length };
        cache.set(clave, { at: Date.now(), valor });
        return valor;
      }
    }
    cache.set(clave, { at: Date.now(), valor: null });
    return null;
  } catch (e) {
    console.warn("[contactoMcp] no se pudo resolver el contacto:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Los ids que trae la respuesta de un MCP.
 *
 * El formato no está estandarizado: lo habitual es `{content:[{type:"text",
 * text:"..."}]}` donde el texto es un JSON con las filas, pero también puede
 * venir el arreglo pelón. Se aceptan las dos formas y, si no se entiende
 * nada, se devuelve vacío — un id mal leído es peor que ninguno.
 */
export function idsDeLaRespuesta(respuesta: unknown): string[] {
  const candidatos: unknown[] = [];

  const texto = textoDelContenido(respuesta);
  if (texto !== null) {
    if (/^\s*sin resultados/i.test(texto)) return [];
    try {
      candidatos.push(JSON.parse(texto));
    } catch {
      return [];
    }
  } else {
    candidatos.push(respuesta);
  }

  const ids: string[] = [];
  for (const c of candidatos) {
    const filas = Array.isArray(c)
      ? c
      : c && typeof c === "object" && Array.isArray((c as { filas?: unknown[] }).filas)
        ? (c as { filas: unknown[] }).filas
        : c && typeof c === "object"
          ? [c]
          : [];
    for (const fila of filas) {
      const id = (fila as { id?: unknown })?.id;
      if (typeof id === "number" || (typeof id === "string" && id.trim() !== "")) ids.push(String(id));
    }
  }
  return ids;
}

/** El texto de `{content:[{type:"text",text}]}`, o null si la respuesta no tiene esa forma. */
function textoDelContenido(respuesta: unknown): string | null {
  const content = (respuesta as { content?: unknown })?.content;
  if (!Array.isArray(content)) return null;
  const partes = content
    .map((p) => (p as { type?: string; text?: string }))
    .filter((p) => p?.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string);
  return partes.length > 0 ? partes.join("\n") : null;
}

function conTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`el CRM no respondió en ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/**
 * Lo que el prompt dice sobre la ficha de esta persona en el CRM.
 *
 * Los tres casos importan, y el tercero es el que faltaba: cuando no se sabe
 * nada, callar deja el hueco que el modelo rellena inventando.
 */
export function lineaDeContactoMcp(resuelto: ContactoResuelto | null, hayMcp: boolean): string | null {
  if (!hayMcp) return null;
  if (!resuelto) {
    return (
      "Esta persona NO está registrada en el CRM conectado (se buscó por su correo y por su teléfono). " +
      "Si vas a registrar algo suyo ahí, créala primero; si no puedes, dilo. Nunca uses un id inventado."
    );
  }
  const aviso =
    resuelto.coincidencias > 1
      ? ` Ojo: hay ${resuelto.coincidencias} fichas que coinciden, se tomó la primera; si algo no cuadra, avísale al equipo.`
      : "";
  return `Su id en el CRM conectado es ${resuelto.id} — úsalo tal cual cuando una herramienta pida el id del contacto, sin buscarlo antes.${aviso}`;
}
