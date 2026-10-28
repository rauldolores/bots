// Importar contactos a Leads desde un Excel o CSV (/admin/leads/importar),
// como el asistente de AduaniaX: archivo → columnas → revisión en seco →
// resultado.
//
// Reglas:
// - Cada fila necesita al menos un teléfono o un correo válido; si no, es
//   error (se puede bajar la lista para corregir).
// - Quien ya es lead (mismo teléfono o correo en lead_contacts) NO se duplica
//   ni se pisa: solo se llenan sus datos vacíos.
// - Quien pidió "no me escriban" (opt_outs) no se importa.
// - Lo importado queda con su import_id: "Deshacer" borra solo eso.
// - Nada de esto escribe a nadie. Mandarles algo es otra cosa (campañas), con
//   sus propias reglas.
import type { Db } from "../db/client";
import type { NichePack } from "../niches/types";
import { normalizeEmail, normalizePhone, phoneVariants, regionForTimezone } from "./normalize";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";
import { leadMetadata, type Lead } from "../db/leads";
import type { Tabla } from "./hojas";

// ── Campos ───────────────────────────────────────────────────────────

export interface CampoImportable {
  /** "nombre", "telefono"… o "giro:<llave>" para los campos del giro. */
  id: string;
  etiqueta: string;
  /** Encabezados que lo delatan, ya sin acentos y en minúsculas. */
  alias: string[];
}

export const IGNORAR = "";
/** La columna se guarda como dato extra del lead, con su encabezado como nombre. */
export const EXTRA = "extra";

const BASE: CampoImportable[] = [
  { id: "nombre", etiqueta: "Nombre", alias: ["nombre", "nombres", "nombre completo", "name", "full name", "first name", "cliente", "apellido", "apellidos", "last name", "razon social"] },
  { id: "telefono", etiqueta: "Teléfono / WhatsApp", alias: ["telefono", "tel", "celular", "cel", "movil", "whatsapp", "wa", "phone", "mobile", "numero", "numero de telefono", "telefono celular", "lada"] },
  { id: "correo", etiqueta: "Correo", alias: ["correo", "email", "e mail", "mail", "correo electronico", "e-mail"] },
  { id: "empresa", etiqueta: "Empresa", alias: ["empresa", "compania", "company", "negocio", "organizacion"] },
  { id: "interes", etiqueta: "Qué busca", alias: ["interes", "interesado en", "que busca", "producto", "servicio", "intencion", "motivo"] },
  { id: "notas", etiqueta: "Notas", alias: ["notas", "nota", "comentarios", "comentario", "observaciones", "notes"] },
];

export function sinAcentos(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036F]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function camposDeImportacion(niche: Pick<NichePack, "columns">): CampoImportable[] {
  const base = new Set(BASE.map((c) => c.id));
  const delGiro = niche.columns
    .filter((c) => !base.has(c.key))
    .map((c) => ({ id: `giro:${c.key}`, etiqueta: c.label, alias: [sinAcentos(c.label), sinAcentos(c.key)] }));
  return [...BASE, ...delGiro];
}

/** Los encabezados normalizados y unidos: dos archivos con las mismas columnas tienen la misma firma. */
export function firmaDe(encabezados: string[]): string {
  return encabezados.map(sinAcentos).join("|");
}

/**
 * Adivina qué es cada columna por su encabezado. Igual exacto gana; si no,
 * que el encabezado contenga el alias como palabra ("Teléfono celular",
 * "Correo de contacto"). Varias columnas pueden ir al mismo campo (Nombre y
 * Apellido, o dos teléfonos). Lo que no se reconoce se ignora.
 */
export function adivinarMapeo(encabezados: string[], campos: CampoImportable[]): string[] {
  return encabezados.map((h) => {
    const n = sinAcentos(h);
    if (!n) return IGNORAR;
    const exacto = campos.find((c) => c.alias.includes(n));
    if (exacto) return exacto.id;
    const palabras = ` ${n} `;
    const parcial = campos.find((c) => c.alias.some((a) => a.length >= 3 && palabras.includes(` ${a} `)));
    return parcial?.id ?? IGNORAR;
  });
}

/** Deja solo valores conocidos; lo demás se ignora. */
export function sanearMapeo(mapeo: unknown[], encabezados: string[], campos: CampoImportable[]): string[] {
  const validos = new Set([IGNORAR, EXTRA, ...campos.map((c) => c.id)]);
  return encabezados.map((_, i) => {
    const v = String(mapeo[i] ?? "");
    return validos.has(v) ? v : IGNORAR;
  });
}

// ── Revisión en seco ─────────────────────────────────────────────────

export interface FilaInterpretada {
  /** Número de fila como se ve en Excel (el encabezado es la 1). */
  numero: number;
  nombre: string | null;
  telefonos: string[];
  correos: string[];
  interes: string | null;
  notas: string | null;
  /** empresa, campos del giro y datos extra. */
  metadata: Record<string, string>;
  /** El primer teléfono o correo, como se ve en la tabla de leads. */
  contacto: string;
}

export interface Revision {
  nuevos: FilaInterpretada[];
  existentes: Array<FilaInterpretada & { leadId: string }>;
  bajas: FilaInterpretada[];
  repetidos: Array<{ numero: number; nombre: string | null; primera: number }>;
  errores: Array<{ numero: number; motivo: string; valores: string[] }>;
}

function unir(valores: string[], sep: string): string | null {
  const v = valores.map((x) => x.trim()).filter(Boolean);
  return v.length ? v.join(sep) : null;
}

/** Una celda puede traer dos teléfonos o correos ("55 1234 5678 / 33 8765 4321"). */
function partes(v: string): string[] {
  return v.split(/\s*[\/;|]\s*|\s+y\s+/).map((x) => x.trim()).filter(Boolean);
}

function interpretar(
  fila: string[],
  numero: number,
  mapeo: string[],
  encabezados: string[],
  region: ReturnType<typeof regionForTimezone>,
): { ok: FilaInterpretada } | { error: string } {
  const de = (id: string) => mapeo.flatMap((m, i) => (m === id && fila[i] ? [fila[i]] : []));
  const telefonos = new Set<string>();
  const correos = new Set<string>();
  const invalidos: string[] = [];
  for (const v of de("telefono")) {
    for (const p of partes(v)) {
      // Un correo en la columna de teléfono también sirve.
      const t = normalizePhone(p, region) ?? null;
      const c = t ? null : normalizeEmail(p);
      if (t) telefonos.add(t);
      else if (c) correos.add(c);
      else invalidos.push(p);
    }
  }
  for (const v of de("correo")) {
    for (const p of partes(v)) {
      const c = normalizeEmail(p);
      if (c) correos.add(c);
      else invalidos.push(p);
    }
  }
  if (telefonos.size === 0 && correos.size === 0) {
    return {
      error: invalidos.length
        ? `${invalidos.length > 1 ? "Los datos de contacto no son válidos" : "El dato de contacto no es válido"}: ${invalidos.join(", ")}`
        : "No trae teléfono ni correo",
    };
  }

  const metadata: Record<string, string> = {};
  const empresa = unir(de("empresa"), " ");
  if (empresa) metadata.empresa = empresa;
  for (const m of new Set(mapeo)) {
    if (m.startsWith("giro:")) {
      const v = unir(de(m), " ");
      if (v) metadata[m.slice(5)] = v;
    }
  }
  mapeo.forEach((m, i) => {
    if (m === EXTRA && fila[i]) metadata[encabezados[i]] = fila[i];
  });

  const tels = [...telefonos];
  const mails = [...correos];
  return {
    ok: {
      numero,
      nombre: unir(de("nombre"), " "),
      telefonos: tels,
      correos: mails,
      interes: unir(de("interes"), " · "),
      notas: unir(de("notas"), " · "),
      metadata,
      contacto: tels[0] ?? mails[0],
    },
  };
}

/** Las claves con que se consulta lead_contacts y opt_outs para esta persona. */
function clavesDe(f: FilaInterpretada): string[] {
  return [...f.telefonos.flatMap(phoneVariants), ...f.correos, ...f.correos.map((c) => `email:${c}`)];
}

async function enTandas<T>(claves: string[], fn: (tanda: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < claves.length; i += 500) out.push(...(await fn(claves.slice(i, i + 500))));
  return out;
}

/** Qué pasaría al importar, sin escribir nada. */
export async function revisarImportacion(db: Db, botId: string, tabla: Tabla, mapeo: string[]): Promise<Revision> {
  const region = regionForTimezone(await new SettingsRepo(db, botId).get(SETTING_KEYS.timezone));
  const rev: Revision = { nuevos: [], existentes: [], bajas: [], repetidos: [], errores: [] };

  const interpretadas: FilaInterpretada[] = [];
  const vistas = new Map<string, number>();
  tabla.filas.forEach((fila, i) => {
    const numero = i + 2;
    const r = interpretar(fila, numero, mapeo, tabla.encabezados, region);
    if ("error" in r) {
      rev.errores.push({ numero, motivo: r.error, valores: fila });
      return;
    }
    const f = r.ok;
    const claves = clavesDe(f);
    const antes = claves.map((k) => vistas.get(k)).find((n) => n !== undefined);
    if (antes !== undefined) {
      rev.repetidos.push({ numero, nombre: f.nombre, primera: antes });
      return;
    }
    claves.forEach((k) => vistas.set(k, numero));
    interpretadas.push(f);
  });

  const todas = [...vistas.keys()];
  const bajas = new Set(
    (await enTandas(todas, (t) =>
      db.all<{ address_norm: string }>(
        `SELECT address_norm FROM opt_outs WHERE bot_id = ? AND address_norm IN (${t.map(() => "?").join(", ")})`,
        [botId, ...t],
      ),
    )).map((r) => r.address_norm),
  );
  // El lead más reciente de cada dirección (el ORDER BY deja el último al final del Map).
  const deQuien = new Map(
    (await enTandas(todas, (t) =>
      db.all<{ address_norm: string; lead_id: string }>(
        `SELECT lc.address_norm, lc.lead_id FROM lead_contacts lc
         JOIN leads l ON l.id = lc.lead_id AND l.bot_id = lc.bot_id
         WHERE lc.bot_id = ? AND lc.address_norm IN (${t.map(() => "?").join(", ")})
         ORDER BY l.created_at ASC`,
        [botId, ...t],
      ),
    )).map((r) => [r.address_norm, r.lead_id] as const),
  );

  for (const f of interpretadas) {
    const claves = clavesDe(f);
    if (claves.some((k) => bajas.has(k))) rev.bajas.push(f);
    else {
      const leadId = claves.map((k) => deQuien.get(k)).find(Boolean);
      if (leadId) rev.existentes.push({ ...f, leadId });
      else rev.nuevos.push(f);
    }
  }
  return rev;
}

// ── Importar ─────────────────────────────────────────────────────────

export interface ResultadoImportacion {
  creados: number;
  completados: number;
}

const TANDA = 200;

/**
 * Escribe lo que dijo la revisión. Los nuevos van por tandas (un INSERT de
 * 200 filas, no 5,000 viajes a la base: en Vercel la función tiene 60 s).
 */
export async function aplicarImportacion(
  db: Db,
  botId: string,
  importId: string,
  rev: Revision,
  opts: { consentimiento: boolean; archivo: string; now?: number },
): Promise<ResultadoImportacion> {
  const now = opts.now ?? Date.now();
  const consent = opts.consentimiento ? "explicit" : "unknown";
  const origen = `Importado de ${opts.archivo}`;

  for (let i = 0; i < rev.nuevos.length; i += TANDA) {
    const tanda = rev.nuevos.slice(i, i + TANDA).map((f) => ({ f, id: crypto.randomUUID() }));
    await db.run(
      `INSERT INTO leads (id, bot_id, conversation_id, name, contact, channel_user_id, intent, notes, metadata, status, import_id, created_at, updated_at)
       VALUES ${tanda.map(() => "(?, ?, NULL, ?, ?, NULL, ?, ?, ?, 'new', ?, ?, ?)").join(", ")}`,
      tanda.flatMap(({ f, id }) => [
        id,
        botId,
        f.nombre,
        f.contacto,
        f.interes ?? "",
        f.notas ? `${f.notas}\n${origen}` : origen,
        Object.keys(f.metadata).length ? JSON.stringify(f.metadata) : null,
        importId,
        now,
        now,
      ]),
    );
    await insertarContactos(db, botId, tanda.map(({ f, id }) => ({ f, leadId: id })), consent, now);
  }

  // Los que ya existían: solo se llena lo vacío. Nunca se pisa un dato.
  let completados = 0;
  for (const f of rev.existentes) {
    const lead = await db.first<Lead>("SELECT * FROM leads WHERE id = ? AND bot_id = ?", [f.leadId, botId]);
    if (!lead) continue;
    const meta = leadMetadata(lead);
    let cambia = false;
    for (const [k, v] of Object.entries(f.metadata)) {
      if (!meta[k]) {
        meta[k] = v;
        cambia = true;
      }
    }
    const nombre = lead.name || f.nombre;
    const contacto = lead.contact || f.contacto;
    const intent = lead.intent || f.interes || "";
    const notas = lead.notes || f.notas;
    cambia ||= nombre !== lead.name || contacto !== lead.contact || intent !== lead.intent || notas !== lead.notes;
    if (cambia) {
      await db.run(
        "UPDATE leads SET name = ?, contact = ?, intent = ?, notes = ?, metadata = ?, updated_at = ? WHERE id = ? AND bot_id = ?",
        [nombre, contacto, intent, notas, Object.keys(meta).length ? JSON.stringify(meta) : null, now, lead.id, botId],
      );
    }
    const nuevos = await insertarContactos(db, botId, [{ f, leadId: lead.id }], consent, now);
    if (cambia || nuevos > 0) completados++;
  }
  return { creados: rev.nuevos.length, completados };
}

/** Teléfonos y correos a lead_contacts; devuelve cuántos eran nuevos. */
async function insertarContactos(
  db: Db,
  botId: string,
  items: Array<{ f: FilaInterpretada; leadId: string }>,
  consent: string,
  now: number,
): Promise<number> {
  const filas = items.flatMap(({ f, leadId }) => [
    ...f.telefonos.map((t) => ({ leadId, kind: "phone", norm: t })),
    ...f.correos.map((c) => ({ leadId, kind: "email", norm: c })),
  ]);
  let nuevos = 0;
  for (let i = 0; i < filas.length; i += TANDA) {
    const tanda = filas.slice(i, i + TANDA);
    const r = await db.all<{ id: string }>(
      `INSERT INTO lead_contacts (id, bot_id, lead_id, kind, channel, address_raw, address_norm, consent, verified, created_at)
       VALUES ${tanda.map(() => "(?, ?, ?, ?, NULL, ?, ?, ?, false, ?)").join(", ")}
       ON CONFLICT (bot_id, lead_id, kind, address_norm) DO NOTHING
       RETURNING id`,
      tanda.flatMap((c) => [crypto.randomUUID(), botId, c.leadId, c.kind, c.norm, c.norm, consent, now]),
    );
    nuevos += r.length;
  }
  return nuevos;
}

/**
 * Borra los leads que creó esta importación y que siguen intactos: sin
 * conversación y todavía en "nuevo". Los que ya tuvieron actividad se quedan
 * (borrarlos perdería esa historia). Lo que se completó en leads que ya
 * existían no se revierte.
 */
export async function deshacerImportacion(db: Db, botId: string, importId: string): Promise<{ borrados: number; conservados: number }> {
  const borrados = await db.all<{ id: string }>(
    `DELETE FROM leads WHERE bot_id = ? AND import_id = ? AND conversation_id IS NULL AND status = 'new' RETURNING id`,
    [botId, importId],
  );
  const quedan = await db.first<{ n: number }>("SELECT COUNT(*)::int AS n FROM leads WHERE bot_id = ? AND import_id = ?", [botId, importId]);
  return { borrados: borrados.length, conservados: Number(quedan?.n ?? 0) };
}
