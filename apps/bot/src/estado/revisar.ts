// Estado del servicio: la revisión de cada 5 minutos (ESTADO_CRON en app.ts) y
// la lectura que pinta el panel. Tablas en supabase/migrations/
// 20261027120000_estado_servicio.sql; catálogo en servicios.ts.
//
// Reglas (las mismas de AduaniaX):
//   - contesta rápido → OPERANDO; contesta lento (> LENTO_MS) → DEGRADADO;
//   - una falla → DEGRADADO (puede ser un tropiezo de red); dos seguidas →
//     CAIDO y se abre una incidencia que el dueño ve en el panel;
//   - al volver a contestar, la incidencia se cierra sola;
//   - cada apertura y cierre se avisa por correo al equipo (ESTADO_AVISOS_CORREO)
//     con el detalle técnico. Al dueño nunca le llega correo: lo ve en el panel.
import { Resend } from "resend";
import type { Env } from "../env";
import { Db } from "../db/client";
import { serviciosVigilados, type ServicioVigilado } from "./servicios";

export const TIEMPO_MS = 10_000;
export const LENTO_MS = 6_000;
export const FALLAS_PARA_INCIDENCIA = 2;
const HISTORIAL_MS = 30 * 24 * 60 * 60 * 1000;

export type Estado = "OPERANDO" | "DEGRADADO" | "CAIDO" | "SIN_DATOS";

export interface Resultado {
  clave: string;
  ok: boolean;
  ms: number | null;
  detalle: string;
}

export interface Cambio {
  clave: string;
  nombre: string;
  accion: "ABRIO" | "CERRO";
  detalle: string;
}

type Fetch = typeof fetch;

async function responde(url: string, esperar200: boolean, f: Fetch): Promise<Omit<Resultado, "clave">> {
  const inicio = Date.now();
  try {
    const res = await f(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(TIEMPO_MS) });
    const ms = Date.now() - inicio;
    const ok = esperar200 ? res.status === 200 : res.status < 500;
    return { ok, ms, detalle: `${url} → HTTP ${res.status} en ${ms} ms` };
  } catch (e) {
    const ms = Date.now() - inicio;
    const nombre = e instanceof Error ? e.name : "";
    const msg = nombre === "TimeoutError" || nombre === "AbortError" ? `sin respuesta en ${TIEMPO_MS / 1000} s` : e instanceof Error ? e.message : String(e);
    return { ok: false, ms, detalle: `${url} → ${msg}` };
  }
}

async function revisarUno(s: ServicioVigilado, db: Db, f: Fetch): Promise<Resultado> {
  if (s.url === "base") {
    const inicio = Date.now();
    try {
      await db.first("SELECT 1 AS uno");
      const ms = Date.now() - inicio;
      return { clave: s.clave, ok: true, ms, detalle: `Consulta a la base en ${ms} ms` };
    } catch (e) {
      return { clave: s.clave, ok: false, ms: Date.now() - inicio, detalle: `Consulta a la base: ${e instanceof Error ? e.message : e}` };
    }
  }
  return { clave: s.clave, ...(await responde(s.url as string, s.esperar200 === true, f)) };
}

interface FilaServicio {
  clave: string;
  estado: Estado;
  fallas_seguidas: number;
  ultima_revision: number | null;
  ultimo_ok: number | null;
}

/**
 * Anota un resultado y decide si abre o cierra una incidencia. Devuelve el
 * cambio (para avisar al equipo) o null.
 */
export async function registrar(db: Db, s: ServicioVigilado, r: Resultado, now: number): Promise<Cambio | null> {
  const previo = await db.first<FilaServicio>(
    "SELECT clave, estado, fallas_seguidas FROM estado_servicios WHERE clave = ?",
    [s.clave],
  );
  const fallas = r.ok ? 0 : (previo?.fallas_seguidas ?? 0) + 1;
  const estado: Estado = r.ok
    ? r.ms != null && r.ms > LENTO_MS
      ? "DEGRADADO"
      : "OPERANDO"
    : fallas >= FALLAS_PARA_INCIDENCIA
      ? "CAIDO"
      : "DEGRADADO";

  await db.run(
    `INSERT INTO estado_servicios (clave, estado, fallas_seguidas, ultima_revision, ultimo_ok, latencia_ms, detalle, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (clave) DO UPDATE SET
       estado = EXCLUDED.estado,
       fallas_seguidas = EXCLUDED.fallas_seguidas,
       ultima_revision = EXCLUDED.ultima_revision,
       ultimo_ok = COALESCE(EXCLUDED.ultimo_ok, estado_servicios.ultimo_ok),
       latencia_ms = EXCLUDED.latencia_ms,
       detalle = EXCLUDED.detalle,
       updated_at = EXCLUDED.updated_at`,
    [s.clave, estado, fallas, now, r.ok ? now : null, r.ms == null ? null : Math.round(r.ms), r.detalle.slice(0, 500), now],
  );

  if (estado === "CAIDO") {
    const abierta = await db.run(
      `INSERT INTO estado_incidentes (id, servicio, titulo, mensaje, origen, inicio)
       VALUES (?, ?, ?, ?, 'AUTOMATICA', ?)
       ON CONFLICT (servicio) WHERE fin IS NULL AND origen = 'AUTOMATICA' DO NOTHING`,
      [crypto.randomUUID(), s.clave, `Falla en ${s.nombre}`, `${s.impacto} Ya estamos dando seguimiento.`, now],
    );
    return abierta.rowsAffected > 0 ? { clave: s.clave, nombre: s.nombre, accion: "ABRIO", detalle: r.detalle } : null;
  }
  if (r.ok) {
    const cerrada = await db.run(
      `UPDATE estado_incidentes SET fin = ?, cierre = ?
       WHERE servicio = ? AND fin IS NULL AND origen = 'AUTOMATICA'`,
      [now, "Se resolvió y el servicio volvió a funcionar con normalidad.", s.clave],
    );
    return cerrada.rowsAffected > 0 ? { clave: s.clave, nombre: s.nombre, accion: "CERRO", detalle: r.detalle } : null;
  }
  return null;
}

/** El correo al equipo: técnico, con lo que contestó cada servicio. */
export function redactarAviso(cambios: Cambio[]): { subject: string; text: string } {
  const abiertas = cambios.filter((c) => c.accion === "ABRIO");
  const subject = abiertas.length
    ? `Nodia Agents: falla en ${abiertas.map((c) => c.nombre).join(", ")}`
    : `Nodia Agents: se recuperó ${cambios.map((c) => c.nombre).join(", ")}`;
  const text = [
    ...cambios.map((c) => `${c.accion === "ABRIO" ? "FALLA" : "RECUPERADO"} · ${c.clave}: ${c.detalle}`),
    "",
    abiertas.length
      ? "Los dueños ya ven el aviso «Ya estamos dando seguimiento» en el panel. La incidencia se cierra sola cuando el servicio vuelve a contestar."
      : "La incidencia se cerró sola y quedó en el historial de Ayuda → Estado del servicio.",
  ].join("\n");
  return { subject, text };
}

async function avisarEquipo(env: Env, cambios: Cambio[]): Promise<void> {
  const to = (env.ESTADO_AVISOS_CORREO ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const apiKey = (env.RESEND_API_KEY ?? "").trim();
  if (!cambios.length || !to.length || !apiKey) return;
  const { subject, text } = redactarAviso(cambios);
  const from = `${(env.SUPPORT_EMAIL_FROM_NAME ?? "").trim() || "Nodia Agents"} <${(env.SUPPORT_EMAIL_FROM ?? "").trim() || "onboarding@resend.dev"}>`;
  try {
    const r = await new Resend(apiKey).emails.send({ from, to, subject, text });
    if (r.error) console.error("[estado] aviso por correo:", r.error);
  } catch (e) {
    console.error("[estado] aviso por correo:", e instanceof Error ? e.message : e);
  }
}

/** La revisión completa. La llama el cron de 5 minutos. */
export async function revisarEstadoServicio(env: Env, opts: { now?: number; fetch?: Fetch } = {}): Promise<Cambio[]> {
  const db = new Db(env.DB);
  const f = opts.fetch ?? fetch;
  const servicios = serviciosVigilados(env).filter((s) => s.url !== null);
  const resultados = await Promise.all(
    servicios.map((s) =>
      revisarUno(s, db, f).catch((e): Resultado => ({ clave: s.clave, ok: false, ms: null, detalle: String(e instanceof Error ? e.message : e) })),
    ),
  );
  const now = opts.now ?? Date.now();
  const cambios: Cambio[] = [];
  for (let i = 0; i < servicios.length; i++) {
    try {
      const c = await registrar(db, servicios[i], resultados[i], now);
      if (c) cambios.push(c);
    } catch (e) {
      console.error(`[estado] no se pudo registrar ${servicios[i].clave}:`, e instanceof Error ? e.message : e);
    }
  }
  await avisarEquipo(env, cambios);
  const caidos = resultados.filter((r) => !r.ok).map((r) => r.clave);
  if (caidos.length || cambios.length) {
    console.log(`[estado] sin respuesta: ${caidos.join(", ") || "ninguno"} · cambios: ${cambios.map((c) => `${c.clave} ${c.accion}`).join(", ") || "ninguno"}`);
  }
  return cambios;
}

// ── Lectura para el panel ───────────────────────────────────────────

export interface ServicioConEstado {
  clave: string;
  nombre: string;
  descripcion: string;
  estado: Estado;
  ultimaRevision: number | null;
}

export interface Incidencia {
  id: string;
  servicio: string | null;
  titulo: string;
  mensaje: string;
  inicio: number;
  fin: number | null;
  cierre: string | null;
}

export interface EstadoPublico {
  servicios: ServicioConEstado[];
  abiertas: Incidencia[];
  historial: Incidencia[];
}

const COLUMNAS_INCIDENCIA = `id, servicio, titulo, mensaje, inicio, fin, cierre`;

/** Solo lo abierto: lo que pide la franja en cada pantalla. Una consulta. */
export async function incidenciasAbiertas(db: Db): Promise<Incidencia[]> {
  return db.all<Incidencia>(`SELECT ${COLUMNAS_INCIDENCIA} FROM estado_incidentes WHERE fin IS NULL ORDER BY inicio DESC`);
}

/**
 * Todo para Ayuda → Estado del servicio, en el orden del catálogo. Un
 * servicio que este despliegue no usa no aparece; uno que todavía no se ha
 * revisado sale como SIN_DATOS. Un error de lectura no tumba la pantalla.
 */
export async function leerEstado(env: Env, now = Date.now()): Promise<EstadoPublico> {
  const db = new Db(env.DB);
  try {
    const [filas, abiertas, historial] = await Promise.all([
      db.all<FilaServicio>("SELECT clave, estado, ultima_revision FROM estado_servicios"),
      incidenciasAbiertas(db),
      db.all<Incidencia>(
        `SELECT ${COLUMNAS_INCIDENCIA} FROM estado_incidentes WHERE fin IS NOT NULL AND inicio > ? ORDER BY inicio DESC LIMIT 50`,
        [now - HISTORIAL_MS],
      ),
    ]);
    const porClave = new Map(filas.map((f) => [f.clave, f]));
    const servicios = serviciosVigilados(env)
      .filter((s) => s.url !== null)
      .map((s) => ({
        clave: s.clave,
        nombre: s.nombre,
        descripcion: s.descripcion,
        estado: porClave.get(s.clave)?.estado ?? "SIN_DATOS",
        ultimaRevision: porClave.get(s.clave)?.ultima_revision ?? null,
      }));
    return { servicios, abiertas, historial };
  } catch (e) {
    console.error("[estado] lectura:", e instanceof Error ? e.message : e);
    return { servicios: [], abiertas: [], historial: [] };
  }
}
