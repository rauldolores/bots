// Avisos automáticos (webhooks salientes): cuando algo pasa en el bot, se le
// manda a la dirección que el dueño configuró en Conexiones → Avisos.
//
//   emitirEvento()  ─▶ webhook_eventos + una webhook_entregas por aviso suscrito
//   procesarEntregas() (cada tick) ─▶ POST firmado ─▶ entregado, o reintento
//
// Emitir es barato y nunca lanza: se llama desde el camino de una captura de
// lead o de una cita, y un aviso no puede tumbar eso. El envío va aparte, en
// el tick, para que un receptor lento no le cueste nada a nadie.
//
// Firma (igual que AduaniaX y Faqturia):
//   X-Nodia-Webhook-Signature: t=<unix>,v1=<hex>
//   v1 = HMAC-SHA256(secreto, "<t>.<cuerpo>")
// El `t` va dentro de lo firmado: un aviso viejo reenviado se nota.
import type { Env } from "../env";
import { Db } from "../db/client";
import { createSecret, deleteSecret, readSecret, updateSecret } from "../db/vault";
import { hmacHex } from "../skills/sign";

export interface TipoDeEvento {
  tipo: string;
  etiqueta: string;
  descripcion: string;
}

/** Los eventos a los que se puede suscribir un aviso, en el orden en que se muestran. */
export const EVENTOS: TipoDeEvento[] = [
  { tipo: "lead.creado", etiqueta: "Lead nuevo", descripcion: "El bot capturó a alguien interesado." },
  { tipo: "lead.estado", etiqueta: "Lead cambió de estado", descripcion: "Pasó a Contactado, Vendido o Perdido." },
  { tipo: "conversacion.escalada", etiqueta: "Conversación pasada a una persona", descripcion: "El bot pidió que alguien del equipo atienda." },
  { tipo: "ticket.creado", etiqueta: "Ticket nuevo", descripcion: "Se abrió un ticket, por el bot o desde el panel." },
  { tipo: "cita.agendada", etiqueta: "Cita agendada", descripcion: "Un cliente agendó (o reagendó) una cita." },
  { tipo: "cita.cancelada", etiqueta: "Cita cancelada", descripcion: "Se canceló una cita." },
  { tipo: "importacion.terminada", etiqueta: "Importación de contactos terminada", descripcion: "Un solo aviso con el resumen, no uno por contacto." },
];

/** El que manda el botón "Probar"; va solo al aviso probado y no se puede suscribir. */
export const EVENTO_PRUEBA = "webhook.prueba";

const TIPOS = new Set(EVENTOS.map((e) => e.tipo));

/** Máximo de avisos por bot. */
export const MAX_AVISOS = 10;
/** Esperas entre intentos, en minutos: 1 min, 5 min, 30 min, 2 h, 6 h, 12 h y 24 h. */
const ESPERAS_MIN = [1, 5, 30, 120, 360, 720, 1440];
/** Intentos por entrega antes de darla por fallida. */
export const MAX_INTENTOS = ESPERAS_MIN.length + 1;
/** Fallos seguidos (de cualquier entrega) tras los que el aviso se apaga solo. */
export const FALLOS_PARA_APAGAR = 50;
/** Cuánto se espera la respuesta del receptor. */
const TIMEOUT_MS = 10_000;
/** Candado de una entrega mientras se envía. */
const CANDADO_MS = 2 * 60_000;
/** Lo que se guarda de la respuesta, para la bitácora. */
const MAX_RESPUESTA = 500;
/** Los eventos (y sus entregas) se borran a los 30 días. */
const RETENCION_MS = 30 * 24 * 60 * 60_000;

export class ErrorDeAviso extends Error {}

// ─── Validar ────────────────────────────────────────────────────────────

/** ¿Es una IP de una red interna (o local)? Acepta IPv4 e IPv6. */
export function esIpInterna(ip: string): boolean {
  const v = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = v.startsWith("::ffff:") ? v.slice(7) : v;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v4);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224 // multicast y reservadas
    );
  }
  if (!v.includes(":")) return false;
  return v === "::" || v === "::1" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
}

/**
 * La dirección limpia, o un error en palabras del dueño. Revisa lo que se ve
 * en el texto; al enviar se revisa además la IP real a la que apunta.
 */
export function validarUrl(raw: string): string {
  const v = (raw ?? "").trim();
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new ErrorDeAviso("Escribe una dirección completa, que empiece con https://");
  }
  if (u.protocol !== "https:") throw new ErrorDeAviso("La dirección debe empezar con https://");
  if (u.username || u.password) throw new ErrorDeAviso("La dirección no puede llevar usuario ni contraseña.");
  const host = u.hostname.toLowerCase();
  if (
    !host.includes(".") && !host.includes(":") ||
    host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") ||
    esIpInterna(host)
  ) {
    throw new ErrorDeAviso("La dirección debe ser pública: no se permiten direcciones internas.");
  }
  if (v.length > 2000) throw new ErrorDeAviso("La dirección es demasiado larga.");
  return u.toString();
}

/** Solo los tipos conocidos, sin repetir, en el orden del catálogo. */
export function limpiarEventos(eventos: unknown[]): string[] {
  const pedidos = new Set(eventos.map((e) => String(e)));
  return EVENTOS.map((e) => e.tipo).filter((t) => pedidos.has(t));
}

export function nuevoSecreto(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return `whsec_${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/** La cabecera X-Nodia-Webhook-Signature de un cuerpo. */
export async function firmar(secreto: string, cuerpo: string, t: number): Promise<string> {
  return `t=${t},v1=${await hmacHex(secreto, `${t}.${cuerpo}`)}`;
}

// ─── Emitir ─────────────────────────────────────────────────────────────

/**
 * Registra que algo pasó y crea su entrega para cada aviso suscrito. Nunca
 * lanza: un aviso no puede tumbar la captura de un lead o una cita.
 */
export async function emitirEvento(db: Db, botId: string, tipo: string, datos: Record<string, unknown>): Promise<void> {
  try {
    await emitir(db, botId, tipo, datos, null);
  } catch (e) {
    console.error(`[webhooks] no se pudo emitir ${tipo}:`, e);
  }
}

async function emitir(db: Db, botId: string, tipo: string, datos: Record<string, unknown>, soloWebhook: string | null): Promise<string | null> {
  const avisos = soloWebhook
    ? await db.all<{ id: string }>("SELECT id FROM webhooks_salientes WHERE id = ? AND bot_id = ?", [soloWebhook, botId])
    : await db.all<{ id: string }>(
        "SELECT id FROM webhooks_salientes WHERE bot_id = ? AND activo AND eventos::jsonb @> jsonb_build_array(?::text)",
        [botId, tipo],
      );
  if (avisos.length === 0) return null;
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.run("INSERT INTO webhook_eventos (id, bot_id, tipo, datos, created_at) VALUES (?, ?, ?, ?, ?)", [
    id,
    botId,
    tipo,
    JSON.stringify(datos ?? {}),
    now,
  ]);
  const marcas = avisos.map(() => "(?, ?, ?, ?, ?)").join(", ");
  await db.run(
    `INSERT INTO webhook_entregas (bot_id, webhook_id, evento_id, proximo_intento, created_at) VALUES ${marcas}
     ON CONFLICT (webhook_id, evento_id) DO NOTHING`,
    avisos.flatMap((a) => [botId, a.id, id, now, now]),
  );
  return id;
}

/** Fecha en ISO, o null. Para los datos de los eventos. */
export function iso(ms: number | string | null | undefined): string | null {
  const n = Number(ms);
  return ms === null || ms === undefined || !Number.isFinite(n) ? null : new Date(n).toISOString();
}

// ─── Administrar (panel) ────────────────────────────────────────────────

export interface Aviso {
  id: string;
  bot_id: string;
  url: string;
  eventos: string[];
  descripcion: string | null;
  activo: boolean;
  fallos_seguidos: number;
  desactivado_motivo: string | null;
  creado_por: string | null;
  created_at: number;
  updated_at: number;
}

export interface Entrega {
  id: number;
  webhook_id: string;
  evento_id: string;
  tipo: string;
  url: string;
  estado: "pendiente" | "entregado" | "fallido";
  intentos: number;
  proximo_intento: number;
  ultimo_codigo: number | null;
  ultima_respuesta: string | null;
  ultimo_error: string | null;
  entregado_at: number | null;
  created_at: number;
}

function json<T>(v: unknown, vacio: T): T {
  if (v === null || v === undefined) return vacio;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return vacio;
    }
  }
  return v as T;
}

const nulo = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function aAviso(r: Record<string, unknown>): Aviso {
  return {
    id: String(r.id),
    bot_id: String(r.bot_id),
    url: String(r.url),
    eventos: json<string[]>(r.eventos, []),
    descripcion: (r.descripcion as string | null) ?? null,
    activo: r.activo === true || r.activo === "t" || r.activo === 1,
    fallos_seguidos: Number(r.fallos_seguidos ?? 0),
    desactivado_motivo: (r.desactivado_motivo as string | null) ?? null,
    creado_por: (r.creado_por as string | null) ?? null,
    created_at: Number(r.created_at),
    updated_at: Number(r.updated_at),
  };
}

function aEntrega(r: Record<string, unknown>): Entrega {
  return {
    id: Number(r.id),
    webhook_id: String(r.webhook_id),
    evento_id: String(r.evento_id),
    tipo: String(r.tipo),
    url: String(r.url),
    estado: r.estado as Entrega["estado"],
    intentos: Number(r.intentos ?? 0),
    proximo_intento: Number(r.proximo_intento),
    ultimo_codigo: nulo(r.ultimo_codigo),
    ultima_respuesta: (r.ultima_respuesta as string | null) ?? null,
    ultimo_error: (r.ultimo_error as string | null) ?? null,
    entregado_at: nulo(r.entregado_at),
    created_at: Number(r.created_at),
  };
}

const COLUMNAS_AVISO = "id, bot_id, url, eventos, descripcion, activo, fallos_seguidos, desactivado_motivo, creado_por, created_at, updated_at";

export class AvisosRepo {
  constructor(
    private readonly db: Db,
    private readonly botId: string,
  ) {}

  async listar(): Promise<Aviso[]> {
    const filas = await this.db.all<Record<string, unknown>>(
      `SELECT ${COLUMNAS_AVISO} FROM webhooks_salientes WHERE bot_id = ? ORDER BY created_at`,
      [this.botId],
    );
    return filas.map(aAviso);
  }

  async get(id: string): Promise<Aviso | null> {
    const r = await this.db.first<Record<string, unknown>>(
      `SELECT ${COLUMNAS_AVISO} FROM webhooks_salientes WHERE id = ? AND bot_id = ?`,
      [id, this.botId],
    );
    return r ? aAviso(r) : null;
  }

  /** Crea el aviso y devuelve su secreto: es la única vez que se muestra. */
  async crear(input: { url: string; eventos: unknown[]; descripcion?: string | null; creadoPor?: string | null }): Promise<{ id: string; secreto: string }> {
    const url = validarUrl(input.url);
    const eventos = limpiarEventos(input.eventos);
    if (eventos.length === 0) throw new ErrorDeAviso("Elige al menos un evento.");
    const n = await this.db.first<{ n: number }>("SELECT COUNT(*)::int AS n FROM webhooks_salientes WHERE bot_id = ?", [this.botId]);
    if (Number(n?.n ?? 0) >= MAX_AVISOS) throw new ErrorDeAviso(`Puedes tener hasta ${MAX_AVISOS} avisos por bot.`);
    const id = crypto.randomUUID();
    const secreto = nuevoSecreto();
    const ref = await createSecret(this.db, secreto, `webhook:${this.botId}:${id}`);
    const now = Date.now();
    await this.db.run(
      `INSERT INTO webhooks_salientes (id, bot_id, url, eventos, descripcion, secret_ref, creado_por, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, this.botId, url, JSON.stringify(eventos), limpiarTexto(input.descripcion), ref, input.creadoPor ?? null, now, now],
    );
    return { id, secreto };
  }

  async actualizar(id: string, input: { url: string; eventos: unknown[]; descripcion?: string | null; activo: boolean }): Promise<void> {
    const url = validarUrl(input.url);
    const eventos = limpiarEventos(input.eventos);
    if (eventos.length === 0) throw new ErrorDeAviso("Elige al menos un evento.");
    const r = await this.db.run(
      // Reactivarlo a mano borra el motivo y la racha de fallos.
      `UPDATE webhooks_salientes SET url = ?, eventos = ?, descripcion = ?,
         fallos_seguidos = CASE WHEN ? AND NOT activo THEN 0 ELSE fallos_seguidos END,
         desactivado_motivo = CASE WHEN ? THEN NULL ELSE desactivado_motivo END,
         activo = ?, updated_at = ?
       WHERE id = ? AND bot_id = ?`,
      [url, JSON.stringify(eventos), limpiarTexto(input.descripcion), input.activo, input.activo, input.activo, Date.now(), id, this.botId],
    );
    if (!r.rowsAffected) throw new ErrorDeAviso("Ese aviso ya no existe.");
  }

  async borrar(id: string): Promise<void> {
    const r = await this.db.first<{ secret_ref: string }>(
      "DELETE FROM webhooks_salientes WHERE id = ? AND bot_id = ? RETURNING secret_ref",
      [id, this.botId],
    );
    if (r?.secret_ref) await deleteSecret(this.db, r.secret_ref).catch(() => {});
  }

  /** Nuevo secreto: el anterior deja de servir en ese momento. */
  async rotarSecreto(id: string): Promise<string> {
    const r = await this.db.first<{ secret_ref: string }>("SELECT secret_ref FROM webhooks_salientes WHERE id = ? AND bot_id = ?", [id, this.botId]);
    if (!r) throw new ErrorDeAviso("Ese aviso ya no existe.");
    const secreto = nuevoSecreto();
    await updateSecret(this.db, r.secret_ref, secreto);
    await this.db.run("UPDATE webhooks_salientes SET updated_at = ? WHERE id = ?", [Date.now(), id]);
    return secreto;
  }

  /** Un aviso de prueba solo a este aviso (aunque esté apagado). */
  async probar(id: string): Promise<void> {
    const ev = await emitir(this.db, this.botId, EVENTO_PRUEBA, { mensaje: "Aviso de prueba de Nodia Agents" }, id);
    if (!ev) throw new ErrorDeAviso("Ese aviso ya no existe.");
  }

  async entregas(opts: { webhookId?: string; limite?: number } = {}): Promise<Entrega[]> {
    const params: unknown[] = [this.botId];
    let filtro = "";
    if (opts.webhookId) {
      filtro = " AND e.webhook_id = ?";
      params.push(opts.webhookId);
    }
    params.push(Math.min(Math.max(opts.limite ?? 50, 1), 200));
    const filas = await this.db.all<Record<string, unknown>>(
      `SELECT e.id, e.webhook_id, e.evento_id, v.tipo, w.url, e.estado, e.intentos, e.proximo_intento,
              e.ultimo_codigo, e.ultima_respuesta, e.ultimo_error, e.entregado_at, e.created_at
         FROM webhook_entregas e
         JOIN webhook_eventos v ON v.id = e.evento_id
         JOIN webhooks_salientes w ON w.id = e.webhook_id
        WHERE e.bot_id = ?${filtro}
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT ?`,
      params,
    );
    return filas.map(aEntrega);
  }

  /** Vuelve a mandar una entrega fallida (o pendiente) en el siguiente minuto: un intento más. */
  async reintentar(entregaId: number): Promise<void> {
    const r = await this.db.run(
      `UPDATE webhook_entregas SET estado = 'pendiente', proximo_intento = ?, tomado_hasta = NULL,
         intentos = LEAST(intentos, ?)
       WHERE id = ? AND bot_id = ? AND estado <> 'entregado'`,
      [Date.now(), MAX_INTENTOS - 1, entregaId, this.botId],
    );
    if (!r.rowsAffected) throw new ErrorDeAviso("Esa entrega ya no se puede reintentar.");
  }

  /** Cuántas entregas pendientes y fallidas hay en los últimos 7 días, por aviso. */
  async resumen(now = Date.now()): Promise<Map<string, { entregadas: number; pendientes: number; fallidas: number }>> {
    const filas = await this.db.all<{ webhook_id: string; estado: string; n: number }>(
      `SELECT webhook_id, estado, COUNT(*)::int AS n FROM webhook_entregas
        WHERE bot_id = ? AND created_at >= ? GROUP BY webhook_id, estado`,
      [this.botId, now - 7 * 24 * 60 * 60_000],
    );
    const out = new Map<string, { entregadas: number; pendientes: number; fallidas: number }>();
    for (const f of filas) {
      const x = out.get(f.webhook_id) ?? { entregadas: 0, pendientes: 0, fallidas: 0 };
      if (f.estado === "entregado") x.entregadas += Number(f.n);
      else if (f.estado === "pendiente") x.pendientes += Number(f.n);
      else x.fallidas += Number(f.n);
      out.set(f.webhook_id, x);
    }
    return out;
  }
}

function limpiarTexto(v: string | null | undefined): string | null {
  const t = (v ?? "").trim().slice(0, 200);
  return t || null;
}

// ─── Enviar (tick) ──────────────────────────────────────────────────────

interface Tomada {
  entrega_id: number;
  intentos: number;
  webhook_id: string;
  url: string;
  secret_ref: string;
  evento_id: string;
  tipo: string;
  datos: unknown;
  evento_creado: number;
  bot_id: string;
  bot_nombre: string | null;
}

/** El resultado de un intento. */
interface Resultado {
  ok: boolean;
  codigo: number | null;
  respuesta: string | null;
  error: string | null;
}

/** Resuelve el host y dice si alguna de sus IPs es interna. Donde no hay DNS (o falla), no bloquea. */
async function apuntaAInterna(host: string): Promise<boolean> {
  try {
    const dns = await import("node:dns/promises");
    const ips = await dns.lookup(host, { all: true });
    return ips.some((x) => esIpInterna(x.address));
  } catch {
    return false;
  }
}

export interface Envio {
  url: string;
  cuerpo: string;
  cabeceras: Record<string, string>;
}

/** Arma el cuerpo y las cabeceras firmadas de una entrega. */
export async function armarEnvio(t: Omit<Tomada, "secret_ref">, secreto: string, ahora = Date.now()): Promise<Envio> {
  const cuerpo = JSON.stringify({
    id: t.evento_id,
    tipo: t.tipo,
    creado: new Date(Number(t.evento_creado)).toISOString(),
    bot: { id: t.bot_id, nombre: t.bot_nombre },
    datos: json<Record<string, unknown>>(t.datos, {}),
  });
  const segundos = Math.floor(ahora / 1000);
  return {
    url: t.url,
    cuerpo,
    cabeceras: {
      "Content-Type": "application/json",
      "User-Agent": "NodiaAgents-Webhooks/1.0",
      "X-Nodia-Event": t.tipo,
      "X-Nodia-Event-Id": t.evento_id,
      "X-Nodia-Delivery": String(t.entrega_id),
      "X-Nodia-Webhook-Signature": await firmar(secreto, cuerpo, segundos),
    },
  };
}

async function enviar(envio: Envio): Promise<Resultado> {
  try {
    const host = new URL(envio.url).hostname;
    if (await apuntaAInterna(host)) {
      return { ok: false, codigo: null, respuesta: null, error: "La dirección apunta a una red interna; no se envió." };
    }
    const res = await fetch(envio.url, {
      method: "POST",
      headers: envio.cabeceras,
      body: envio.cuerpo,
      // Una redirección podría llevar el aviso a una dirección interna.
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const texto = (await res.text().catch(() => "")).slice(0, MAX_RESPUESTA);
    const ok = res.status >= 200 && res.status < 300;
    return {
      ok,
      codigo: res.status,
      respuesta: texto || null,
      error: ok ? null : res.status >= 300 && res.status < 400 ? `Respondió con una redirección (HTTP ${res.status}); los avisos no las siguen.` : `HTTP ${res.status}`,
    };
  } catch (e) {
    const nombre = (e as { name?: string })?.name;
    const msg = nombre === "TimeoutError" || nombre === "AbortError"
      ? `No respondió en ${TIMEOUT_MS / 1000} segundos.`
      : `No se pudo conectar: ${e instanceof Error ? e.message : String(e)}`;
    return { ok: false, codigo: null, respuesta: null, error: msg.slice(0, MAX_RESPUESTA) };
  }
}

/** Toma (con candado) las entregas vencidas, con lo necesario para mandarlas. */
async function tomar(db: Db, limite: number, now: number): Promise<Tomada[]> {
  const filas = await db.all<Record<string, unknown>>(
    `WITH tomadas AS (
       SELECT e.id FROM webhook_entregas e
        WHERE e.estado = 'pendiente' AND e.proximo_intento <= ?
          AND (e.tomado_hasta IS NULL OR e.tomado_hasta < ?)
        ORDER BY e.proximo_intento
        LIMIT ?
        FOR UPDATE SKIP LOCKED
     ), marcadas AS (
       UPDATE webhook_entregas e SET tomado_hasta = ?, intentos = e.intentos + 1
        WHERE e.id IN (SELECT id FROM tomadas)
        RETURNING e.id, e.intentos, e.webhook_id, e.evento_id, e.bot_id
     )
     SELECT m.id AS entrega_id, m.intentos, m.webhook_id, w.url, w.secret_ref, w.activo,
            m.evento_id, v.tipo, v.datos, v.created_at AS evento_creado, m.bot_id, b.name AS bot_nombre
       FROM marcadas m
       JOIN webhooks_salientes w ON w.id = m.webhook_id
       JOIN webhook_eventos v ON v.id = m.evento_id
       LEFT JOIN bots b ON b.id = m.bot_id`,
    [now, now, limite, now + CANDADO_MS],
  );
  const out: Tomada[] = [];
  for (const r of filas) {
    const t: Tomada = {
      entrega_id: Number(r.entrega_id),
      intentos: Number(r.intentos),
      webhook_id: String(r.webhook_id),
      url: String(r.url),
      secret_ref: String(r.secret_ref),
      evento_id: String(r.evento_id),
      tipo: String(r.tipo),
      datos: r.datos,
      evento_creado: Number(r.evento_creado),
      bot_id: String(r.bot_id),
      bot_nombre: (r.bot_nombre as string | null) ?? null,
    };
    const activo = r.activo === true || r.activo === "t" || r.activo === 1;
    // Un aviso apagado no manda nada, salvo su prueba (que se pide a propósito).
    if (!activo && t.tipo !== EVENTO_PRUEBA) {
      await db.run("UPDATE webhook_entregas SET estado = 'fallido', tomado_hasta = NULL, ultimo_error = ? WHERE id = ?", [
        "El aviso está apagado; no se envió.",
        t.entrega_id,
      ]);
      continue;
    }
    out.push(t);
  }
  return out;
}

/** Registra el resultado y programa el siguiente intento. Devuelve true si el aviso se acaba de apagar. */
async function registrar(db: Db, t: Tomada, r: Resultado, now: number): Promise<boolean> {
  if (r.ok) {
    await db.run(
      `UPDATE webhook_entregas SET estado = 'entregado', entregado_at = ?, tomado_hasta = NULL,
         ultimo_codigo = ?, ultima_respuesta = ?, ultimo_error = NULL
       WHERE id = ?`,
      [now, r.codigo, r.respuesta, t.entrega_id],
    );
    await db.run("UPDATE webhooks_salientes SET fallos_seguidos = 0 WHERE id = ? AND fallos_seguidos <> 0", [t.webhook_id]);
    return false;
  }
  const agotada = t.intentos >= MAX_INTENTOS;
  const espera = ESPERAS_MIN[Math.min(t.intentos, ESPERAS_MIN.length) - 1] ?? ESPERAS_MIN[ESPERAS_MIN.length - 1];
  await db.run(
    `UPDATE webhook_entregas SET estado = ?, proximo_intento = ?, tomado_hasta = NULL,
       ultimo_codigo = ?, ultima_respuesta = ?, ultimo_error = ?
     WHERE id = ?`,
    [agotada ? "fallido" : "pendiente", now + espera * 60_000, r.codigo, r.respuesta, r.error, t.entrega_id],
  );
  // La prueba no cuenta para apagar el aviso: es justo lo que se usa para arreglarlo.
  if (t.tipo === EVENTO_PRUEBA) return false;
  // Solo una actualización llega exactamente al tope (cada una bloquea la
  // fila): esa es la que avisa al dueño, aunque fallen varias en el mismo tick.
  const fila = await db.first<{ recien_apagado: boolean }>(
    `UPDATE webhooks_salientes SET
       fallos_seguidos = fallos_seguidos + 1,
       desactivado_motivo = CASE WHEN fallos_seguidos + 1 = ? AND activo THEN ? ELSE desactivado_motivo END,
       activo = CASE WHEN fallos_seguidos + 1 >= ? THEN false ELSE activo END
     WHERE id = ?
     RETURNING (fallos_seguidos = ? AND desactivado_motivo IS NOT NULL) AS recien_apagado`,
    [FALLOS_PARA_APAGAR, motivoDeApagado(r), FALLOS_PARA_APAGAR, t.webhook_id, FALLOS_PARA_APAGAR],
  );
  return fila?.recien_apagado === true;
}

function motivoDeApagado(r: Resultado): string {
  return `Se apagó solo tras ${FALLOS_PARA_APAGAR} intentos fallidos seguidos. Último error: ${(r.error ?? `HTTP ${r.codigo}`).slice(0, 200)}`;
}

/** Manda las entregas que toca. Lo llama el tick; nunca lanza por una entrega. */
export async function procesarEntregas(env: Env, limite = 20, now = Date.now()): Promise<{ enviadas: number; fallidas: number }> {
  const db = new Db(env.DB);
  const tomadas = await tomar(db, limite, now);
  if (tomadas.length === 0) return { enviadas: 0, fallidas: 0 };

  // Un secreto por aviso, aunque lleve varias entregas.
  const secretos = new Map<string, Promise<string | null>>();
  const secretoDe = (t: Tomada) => {
    if (!secretos.has(t.webhook_id)) secretos.set(t.webhook_id, readSecret(db, t.secret_ref).catch(() => null));
    return secretos.get(t.webhook_id)!;
  };

  let enviadas = 0;
  let fallidas = 0;
  await Promise.all(
    tomadas.map(async (t) => {
      const secreto = await secretoDe(t);
      const r: Resultado = secreto
        ? await enviar(await armarEnvio(t, secreto))
        : { ok: false, codigo: null, respuesta: null, error: "No se pudo leer el secreto de firma del aviso." };
      if (r.ok) enviadas++;
      else fallidas++;
      try {
        if (await registrar(db, t, r, Date.now())) await avisarApagado(env, t);
      } catch (e) {
        console.error(`[webhooks] no se pudo registrar la entrega ${t.entrega_id}:`, e);
      }
    }),
  );
  return { enviadas, fallidas };
}

async function avisarApagado(env: Env, t: Tomada): Promise<void> {
  const { notifyOwner } = await import("../tools/handoffHuman");
  await notifyOwner(
    env,
    {
      reason: "aviso automático apagado",
      summary: `El aviso a ${new URL(t.url).host} falló ${FALLOS_PARA_APAGAR} veces seguidas y se apagó solo. Revisa la dirección y vuelve a encenderlo en Conexiones → Avisos.`,
      ticketId: t.webhook_id,
      titulo: "Un aviso automático dejó de funcionar",
      ruta: "/admin/conexiones?cat=avisos",
    },
    t.bot_id,
  ).catch((e) => console.error("[webhooks] no se pudo avisar al dueño:", e));
}

/** Borra los eventos (y sus entregas) de más de 30 días. Corrida diaria. */
export async function purgarWebhooks(db: Db, now = Date.now()): Promise<number> {
  const r = await db.run("DELETE FROM webhook_eventos WHERE created_at < ?", [now - RETENCION_MS]);
  return r.rowsAffected ?? 0;
}
