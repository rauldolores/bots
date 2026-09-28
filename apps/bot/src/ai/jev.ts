// JEV AI (TypeSafe): el clasificador rápido.
//
// No escribe texto: recibe un "estado" (un mensaje, un párrafo, un pasaje) y
// preguntas cerradas —sí/no, una opción de una lista, un nivel— y devuelve la
// respuesta con su probabilidad en ~150 ms. Sirve para decidir, no para
// contestar. Evaluación en español: scripts/evaluar-jev/ (fase 0, 2026-09-27).
//
// Tres reglas que no se negocian, porque esto se mete en el camino de un turno:
//
//   1. NUNCA LANZA. Cualquier falla —sin llave, se cayó, tardó de más,
//      respondió algo raro— devuelve null, y quien preguntó sigue con la
//      lógica de siempre. Un clasificador que tumba un turno no vale lo que
//      ahorra.
//   2. TIENE UN TOPE DE TIEMPO corto y sin reintentos: un reintento tras
//      800 ms ya es una espera que el cliente nota.
//   3. NO ESCRIBE EN LOS LOGS lo que se le manda: son mensajes de clientes. El
//      SDK en modo depuración imprime el cuerpo de cada petición; va apagado.
//
// Cada bot decide si lo usa (ajuste `jev_modo`): apagado, sombra (decide y
// anota en `clasificaciones` sin cambiar nada) o activo.
import { TypeSafeClient, type Questions, type SystemOneResult, type EntryType } from "@typesafe-ai/sdk";
import type { Env } from "../env";
import type { Db } from "../db/client";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";
import { registrarUso } from "../db/aiUsage";

/**
 * La versión fija, no el alias "jev-latest": el alias se mueve solo cuando
 * sale otra versión, y los umbrales se calibran contra UNA versión. Cambiar
 * de versión es una decisión: se vuelve a correr scripts/evaluar-jev.
 */
export const MODELO_JEV = "jev-1.13.0";

/** Suficiente para el p95 medido (~200 ms) más la red desde el despliegue, sin que el cliente note la espera. */
export const TIEMPO_MAXIMO_MS = 800;

/**
 * Tope de cada llamada cuando NADIE la espera (sombra, trabajos de cola).
 * Más holgado que el de arriba: aquí una llamada lenta solo cuesta una
 * anotación perdida, y perderlas empobrece justo los datos con los que se
 * decide pasar a "activo".
 */
export const TIEMPO_EN_SOMBRA_MS = 2_500;

export type ModoJev = "apagado" | "sombra" | "activo";

export function esModoJev(v: unknown): v is ModoJev {
  return v === "apagado" || v === "sombra" || v === "activo";
}

/**
 * Dónde puede ACTUAR el revisor en modo activo. Cada uno se prende por
 * separado porque cada uno se justifica (o no) con sus propios datos de
 * sombra: que la búsqueda gane mucho no dice nada de las promesas.
 */
export const USOS_ACTIVABLES = ["busqueda", "promesas", "seguimientos"] as const;
export type UsoActivable = (typeof USOS_ACTIVABLES)[number];

export function leerActivoEn(raw: string | null | undefined): Set<UsoActivable> {
  const validos = new Set<string>(USOS_ACTIVABLES);
  return new Set(
    (raw ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter((x): x is UsoActivable => validos.has(x)),
  );
}

export interface EstadoJev {
  modo: ModoJev;
  /** ¿Puede cambiar algo en este uso? Solo en activo y si ese uso está prendido. */
  actuaEn(uso: UsoActivable): boolean;
}

/** El modo del bot y en qué usos actúa, con una sola lectura de ajustes. */
export async function estadoJev(env: Env, db: Db, botId: string): Promise<EstadoJev> {
  if (!jevDisponible(env)) return { modo: "apagado", actuaEn: () => false };
  const settings = new SettingsRepo(db, botId);
  const [m, lista] = await Promise.all([
    settings.get(SETTING_KEYS.jevModo).catch(() => null),
    settings.get(SETTING_KEYS.jevActivoEn).catch(() => null),
  ]);
  const modo: ModoJev = esModoJev(m) ? m : "apagado";
  const activoEn = leerActivoEn(lista);
  return { modo, actuaEn: (uso) => modo === "activo" && activoEn.has(uso) };
}

export function jevDisponible(env: Env): boolean {
  return !!env.TYPESAFE_API_KEY?.trim();
}

/**
 * Cómo usa Jev este bot. Sin llave en el despliegue es "apagado" aunque el
 * ajuste diga otra cosa: el ajuste puede venir de antes de quitar la llave.
 */
export async function modoJev(env: Env, db: Db, botId: string): Promise<ModoJev> {
  if (!jevDisponible(env)) return "apagado";
  const v = await new SettingsRepo(db, botId).get(SETTING_KEYS.jevModo).catch(() => null);
  return esModoJev(v) ? v : "apagado";
}

export interface Clasificacion<Q extends Questions> {
  respuestas: SystemOneResult<Q>["answers"];
  modelo: string;
  ms: number;
}

export interface OpcionesDeClasificar {
  botId: string;
  /** Qué lugar de la app pregunta: aparece en `clasificaciones.uso` y ayuda a leer los costos. */
  uso: string;
  /** La conversación, si la hay: el costo se suma al de esa conversación. */
  refId?: string | null;
  timeoutMs?: number;
  /** Solo pruebas: sustituye la red. */
  fetch?: typeof fetch;
}

/**
 * Hace las preguntas sobre el estado. Todas van en UNA llamada (se evalúan en
 * paralelo; agregar preguntas casi no cambia el tiempo). Devuelve null si
 * algo falla — ver la regla 1 arriba.
 */
export async function clasificar<const Q extends Questions>(
  env: Env,
  db: Db,
  estado: EntryType,
  preguntas: Q,
  opts: OpcionesDeClasificar,
): Promise<Clasificacion<Q> | null> {
  if (!jevDisponible(env)) return null;
  const inicio = Date.now();
  try {
    const cliente = new TypeSafeClient({
      apiKey: env.TYPESAFE_API_KEY!.trim(),
      defaultModel: MODELO_JEV,
      timeout: opts.timeoutMs ?? TIEMPO_MAXIMO_MS,
      retry: { maxRetries: 0 },
      logLevel: "off",
      ...(opts.fetch ? { fetch: opts.fetch as never } : {}),
    });
    const r = await cliente.systemOne({ state: estado, questions: preguntas, model: MODELO_JEV });
    const ms = Date.now() - inicio;
    await registrarUso(db, opts.botId, {
      source: "clasificador",
      refId: opts.refId ?? null,
      modelUsed: r.model,
      usage: { inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens },
    });
    return { respuestas: r.answers, modelo: r.model, ms };
  } catch (e) {
    // Sin el mensaje del cliente: solo qué uso falló y por qué.
    console.warn(`[jev] ${opts.uso} sin respuesta tras ${Date.now() - inicio} ms: ${e instanceof Error ? e.name + ": " + e.message : String(e)}`);
    return null;
  }
}

/**
 * Anota una decisión para compararla después con la lógica de siempre. En
 * sombra es TODO lo que pasa; en activo, queda el registro de por qué se hizo
 * lo que se hizo. Nunca lanza: perder una anotación no justifica tumbar nada.
 *
 * Ojo al leer `jev`/`regla`: postgres.js guarda el JSON como una CADENA dentro
 * del jsonb (igual que work_jobs.payload); para consultar sus campos en SQL,
 * `(jev #>> '{}')::jsonb->…` — ver WorkJobsRepo.cancelNurtureTouchesForLead.
 */
export async function anotarClasificacion(
  db: Db,
  botId: string,
  input: {
    uso: string;
    refId?: string | null;
    modo: Exclude<ModoJev, "apagado">;
    clasificacion: Clasificacion<Questions>;
    /** Lo que decidió la lógica de hoy, para comparar. */
    regla?: unknown;
  },
): Promise<void> {
  try {
    await db.run(
      `INSERT INTO clasificaciones (id, bot_id, uso, ref_id, modo, modelo, jev, regla, ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?)`,
      [
        crypto.randomUUID(),
        botId,
        input.uso,
        input.refId ?? null,
        input.modo,
        input.clasificacion.modelo,
        JSON.stringify(input.clasificacion.respuestas),
        input.regla === undefined ? null : JSON.stringify(input.regla),
        Math.round(input.clasificacion.ms),
        Date.now(),
      ],
    );
  } catch (e) {
    console.warn(`[jev] no se pudo anotar la clasificación de ${input.uso}:`, e instanceof Error ? e.message : e);
  }
}
