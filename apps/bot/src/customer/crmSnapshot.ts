/**
 * El contexto del CRM, en caché.
 *
 * Leerlo cuesta cuatro llamadas HTTP encadenadas. Hacerlas durante el turno
 * sería repetir el error que ya medimos con el MCP: 1–3 segundos de espera del
 * cliente en CADA mensaje, y encima invisibles cuando fallan.
 *
 * La salida está en algo que el sistema ya hace: el bot no responde de
 * inmediato, espera el buffer (5s en producción) por si el cliente sigue
 * escribiendo. Durante esos segundos la función sigue viva sin hacer nada —
 * ahí se calienta esto. Cuando el turno corre, solo lee la tabla.
 *
 * Regla que no se rompe: **el turno nunca espera al CRM**. Si la caché está
 * fría o vencida, se responde sin ese contexto y se calienta para la próxima.
 */
import type { Env } from "../env";
import type { Db } from "../db/client";
import type { Lead } from "../db/leads";
import { BotConnectorsRepo } from "../db/botConnectors";
import { CRM_ADAPTERS } from "../connectors/registry";
import { resolveConnectorCreds } from "../connectors/creds";
import type { CrmCustomerSnapshot } from "../connectors/types";

/**
 * Cuánto vale un snapshot antes de volver a pedirlo.
 *
 * Diez minutos es más que una conversación típica: dentro de un mismo chat se
 * lee una vez y ya. Y si el operador movió algo en el CRM mientras tanto, la
 * siguiente conversación lo verá.
 */
const VIGENCIA_MS = 10 * 60_000;

/** Tope del calentamiento. Si el CRM tarda más, se abandona: hay un buffer que respetar. */
const TIMEOUT_MS = 4_000;

interface FilaSnapshot {
  data: unknown;
  fetched_at: number;
}

/** Lo que hay en caché, si sigue vigente. Una sola consulta local — esto SÍ corre en el turno. */
export async function readCrmSnapshot(
  db: Db,
  botId: string,
  leadId: string,
): Promise<CrmCustomerSnapshot | null> {
  try {
    const fila = await db.first<FilaSnapshot>(
      "SELECT data, fetched_at FROM crm_snapshots WHERE bot_id = ? AND lead_id = ?",
      [botId, leadId],
    );
    if (!fila) return null;
    if (Date.now() - fila.fetched_at > VIGENCIA_MS) return null;
    return (typeof fila.data === "string" ? JSON.parse(fila.data) : fila.data) as CrmCustomerSnapshot;
  } catch (e) {
    console.warn("[crmSnapshot] no se pudo leer la caché:", e);
    return null;
  }
}

/** ¿Vale la pena calentar? Falso si ya está fresco — para no pegarle al CRM en cada mensaje de un mismo chat. */
async function necesitaCalentarse(db: Db, botId: string, leadId: string): Promise<boolean> {
  try {
    const fila = await db.first<{ fetched_at: number }>(
      "SELECT fetched_at FROM crm_snapshots WHERE bot_id = ? AND lead_id = ?",
      [botId, leadId],
    );
    return !fila || Date.now() - fila.fetched_at > VIGENCIA_MS;
  } catch {
    return false; // ante la duda, no molestar al CRM
  }
}

function conTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`el CRM no respondió en ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * Va al CRM y guarda lo que sepa de este lead. Corre FUERA del turno.
 *
 * Nunca lanza: es una mejora oportunista. Que falle solo significa que el
 * próximo turno responderá con lo que el bot ya sabía por su cuenta.
 */
export async function refreshCrmSnapshot(env: Env, db: Db, botId: string, lead: Lead): Promise<void> {
  try {
    if (!lead.contact) return;
    if (!(await necesitaCalentarse(db, botId, lead.id))) return;

    const connector = await new BotConnectorsRepo(db).getActiveByCategory(botId, "crm");
    if (!connector) return;
    const adapter = CRM_ADAPTERS[connector.provider];
    if (!adapter?.lookupCustomer) return; // proveedor sin lectura de contexto

    const creds = await resolveConnectorCreds(db, connector, env);
    if (!creds) return;

    const esEmail = lead.contact.includes("@");
    const snapshot = await conTimeout(
      adapter.lookupCustomer(creds, {
        email: esEmail ? lead.contact : null,
        telefono: esEmail ? null : lead.contact,
      }),
      TIMEOUT_MS,
    );
    if (!snapshot) return;

    await db.run(
      `INSERT INTO crm_snapshots (bot_id, lead_id, data, fetched_at)
       VALUES (?, ?, ?::jsonb, ?)
       ON CONFLICT (bot_id, lead_id) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`,
      [botId, lead.id, JSON.stringify(snapshot), Date.now()],
    );
  } catch (e) {
    console.warn("[crmSnapshot] no se pudo calentar el contexto del CRM:", e);
  }
}

/** Lo que el modelo lee del CRM. `null` si no hay nada que aporte. */
export function renderCrmSnapshot(s: CrmCustomerSnapshot | null): string | null {
  if (!s) return null;
  const lineas: string[] = [];

  if (s.empresa) {
    const detalle = [s.empresa.industria, s.empresa.tamano ? `${s.empresa.tamano} empleados` : null]
      .filter(Boolean)
      .join(", ");
    lineas.push(`Trabaja en ${s.empresa.nombre}${detalle ? ` (${detalle})` : ""}.`);
  }
  if (s.cargo) lineas.push(`Su puesto: ${s.cargo}.`);

  if (s.oportunidades.length > 0) {
    lineas.push(
      `Oportunidades abiertas en el CRM: ${s.oportunidades
        .map((o) => `"${o.nombre}"${o.etapa ? ` en etapa ${o.etapa}` : ""}${o.monto ? ` por ${o.monto}` : ""}`)
        .join("; ")}.`,
    );
  }
  if (s.notasRecientes.length > 0) {
    lineas.push(`Últimas notas del equipo:\n${s.notasRecientes.map((n) => `- ${n.texto}`).join("\n")}`);
  }

  return lineas.length > 0 ? lineas.join("\n") : null;
}
