// Borra todo lo que dejó un run de pruebas: en la base del bot y en Vinqulia.
//
// Regla de oro: solo se borra lo que se puede PROBAR que es de la prueba.
//   - En la base: las conversaciones que abrió el run (se sabe su canal y su
//     id de usuario exactos) y lo que cuelga de ellas.
//   - En Vinqulia: los tickets y tareas cuyo id quedó guardado en esas
//     conversaciones, y los contactos cuyo correo o teléfono es de prueba. Si
//     el agente enganchó el lead a un contacto REAL que ya existía (mismo
//     nombre, por ejemplo), ese contacto no se toca: se reporta.
import { Db } from "../../src/db/client";
import type { Env } from "../../src/env";
import { conversationKeyOf } from "../../src/agent/key";
import { BotConnectorsRepo } from "../../src/db/botConnectors";
import { resolveConnectorCreds } from "../../src/connectors/creds";
import { vinquliaBaseUrl, vinquliaHeaders } from "../../src/connectors/vinquliaApi";
import type { ConnectorCreds } from "../../src/connectors/types";

export interface Marca {
  channel: string;
  channelUserId: string;
  correo?: string;
}

export interface ResumenLimpieza {
  conversaciones: number;
  tickets: number;
  leads: number;
  citas: number;
  vinqulia: string[];
  pendientes: string[];
}

/** Un correo o teléfono de prueba — ver `identidadDe` en correr.ts. */
export function esDatoDePrueba(valor: string): boolean {
  const v = valor.toLowerCase();
  return v.includes("nodia-prueba-") || v.replace(/\D/g, "").includes("550000");
}

export async function limpiar(env: Env, botId: string, marcas: Marca[]): Promise<ResumenLimpieza> {
  const db = new Db(env.DB);
  const r: ResumenLimpieza = { conversaciones: 0, tickets: 0, leads: 0, citas: 0, vinqulia: [], pendientes: [] };

  const convs: { id: string; channel: string; channel_user_id: string }[] = [];
  for (const m of marcas) {
    const c = await db.first<{ id: string; channel: string; channel_user_id: string }>(
      "SELECT id, channel, channel_user_id FROM conversations WHERE bot_id = ? AND channel = ? AND channel_user_id = ?",
      [botId, m.channel, m.channelUserId],
    );
    if (c) convs.push(c);
  }
  const ids = convs.map((c) => c.id);

  // El lead de una llamada se manda al CRM en segundo plano (leads/postCaptura):
  // hasta que ese envío termina, el id del contacto no está guardado aquí y la
  // limpieza no sabría qué borrar allá. Se le da hasta 60 s.
  if (ids.length > 0) {
    const marcasSql = ids.map(() => "?").join(",");
    for (let i = 0; i < 12; i++) {
      const pendiente = await db.first<{ n: number }>(
        `SELECT COUNT(*) AS n FROM leads WHERE bot_id = ? AND conversation_id IN (${marcasSql}) AND external_id IS NULL`,
        [botId, ...ids],
      );
      if (!Number(pendiente?.n ?? 0)) break;
      await new Promise((res) => setTimeout(res, 5000));
    }
  }

  // Lo externo PRIMERO: sin las filas locales ya no se sabe qué ids buscar.
  if (ids.length > 0) {
    const marcasSql = ids.map(() => "?").join(",");
    const externos = {
      tickets: (
        await db.all<{ external_id: string | null }>(
          `SELECT external_id FROM tickets WHERE bot_id = ? AND conversation_id IN (${marcasSql}) AND external_id IS NOT NULL`,
          [botId, ...ids],
        )
      ).map((t) => t.external_id!),
      tareas: (
        await db.all<{ external_ref: string | null }>(
          `SELECT external_ref FROM appointments WHERE bot_id = ? AND conversation_id IN (${marcasSql}) AND external_ref IS NOT NULL`,
          [botId, ...ids],
        )
      ).map((a) => a.external_ref!),
      contactos: (
        await db.all<{ external_id: string | null }>(
          `SELECT external_id FROM leads WHERE bot_id = ? AND conversation_id IN (${marcasSql}) AND external_id IS NOT NULL`,
          [botId, ...ids],
        )
      ).map((l) => l.external_id!),
    };
    await limpiarVinqulia(env, db, botId, externos, marcas, r);
  }

  for (const c of convs) {
    const key = conversationKeyOf(botId, c.channel, c.channel_user_id);
    const leadIds = (
      await db.all<{ id: string }>("SELECT id FROM leads WHERE bot_id = ? AND conversation_id = ?", [botId, c.id])
    ).map((l) => l.id);
    for (const leadId of leadIds) {
      await db.run("DELETE FROM lead_touches WHERE lead_id = ?", [leadId]).catch(() => {});
      await db.run("DELETE FROM crm_snapshots WHERE lead_id = ?", [leadId]).catch(() => {});
      await db.run("DELETE FROM crm_proposals WHERE lead_id = ?", [leadId]).catch(() => {});
    }
    r.leads += (await db.run("DELETE FROM leads WHERE bot_id = ? AND conversation_id = ?", [botId, c.id])).rowsAffected;
    r.tickets += (await db.run("DELETE FROM tickets WHERE bot_id = ? AND conversation_id = ?", [botId, c.id])).rowsAffected;
    r.citas += (await db.run("DELETE FROM appointments WHERE bot_id = ? AND conversation_id = ?", [botId, c.id])).rowsAffected;
    for (const tabla of [
      "customer_facts",
      "crm_proposals",
      "conv_labels",
      "keyword_hits",
      "followup_sends",
      "template_sends",
      "tracked_links",
      "campaign_jobs",
    ]) {
      await db.run(`DELETE FROM ${tabla} WHERE conversation_id = ?`, [c.id]).catch(() => {});
    }
    // El análisis del CRM se encola con retraso: si no se borra, correría
    // después sobre una conversación que ya no existe.
    await db.run("DELETE FROM work_jobs WHERE bot_id = ? AND payload->>'conversationId' = ?", [botId, c.id]).catch(() => {});
    await db.run("DELETE FROM pending_messages WHERE conversation_key = ?", [key]).catch(() => {});
    await db.run("DELETE FROM agent_jobs WHERE conversation_key = ?", [key]).catch(() => {});
    await db.run("DELETE FROM agent_state WHERE conversation_key = ?", [key]).catch(() => {});
    // messages, conversation_insights y voice_sessions (con sus eventos) caen en cascada.
    r.conversaciones += (await db.run("DELETE FROM conversations WHERE id = ? AND bot_id = ?", [c.id, botId])).rowsAffected;
  }

  const correos = marcas.map((m) => m.correo).filter((c): c is string => !!c);
  for (const correo of correos) {
    await db.run("DELETE FROM correos_filtrados WHERE bot_id = ? AND remitente = ?", [botId, correo]).catch(() => {});
  }
  return r;
}

async function limpiarVinqulia(
  env: Env,
  db: Db,
  botId: string,
  externos: { tickets: string[]; tareas: string[]; contactos: string[] },
  marcas: Marca[],
  r: ResumenLimpieza,
): Promise<void> {
  const conectores = new BotConnectorsRepo(db);
  const credsDe = async (categoria: string): Promise<ConnectorCreds | null> => {
    const c = await conectores.getActiveByCategory(botId, categoria).catch(() => null);
    if (!c || !c.provider.startsWith("vinqulia")) return null;
    return resolveConnectorCreds(db, c, env).catch(() => null);
  };
  const creds = (await credsDe("crm")) ?? (await credsDe("tickets")) ?? (await credsDe("calendar"));
  if (!creds) return;
  const base = vinquliaBaseUrl(creds);
  if (!base) return;
  const h = vinquliaHeaders(creds);
  const get = async <T>(ruta: string): Promise<T[]> => {
    const res = await fetch(`${base}${ruta}`, { headers: h });
    return res.ok ? ((await res.json()) as T[]) : [];
  };
  const borrar = async (ruta: string, que: string) => {
    const res = await fetch(`${base}${ruta}`, { method: "DELETE", headers: { ...h, Prefer: "return=representation" } });
    if (!res.ok) {
      r.pendientes.push(`Vinqulia: no se pudo borrar ${que} (${res.status})`);
      return 0;
    }
    const filas = (await res.json().catch(() => [])) as unknown[];
    if (filas.length > 0) r.vinqulia.push(`${que}: ${filas.length}`);
    return filas.length;
  };

  const contactos = new Set<string>(externos.contactos);
  for (const id of externos.tickets) {
    const [t] = await get<{ contact_id: number | null }>(`/tickets?id=eq.${encodeURIComponent(id)}&select=contact_id`);
    if (t?.contact_id != null) contactos.add(String(t.contact_id));
    await borrar(`/tickets?id=eq.${encodeURIComponent(id)}`, `ticket ${id}`);
  }
  for (const id of externos.tareas) {
    const [t] = await get<{ contact_id: number | null }>(`/tasks?id=eq.${encodeURIComponent(id)}&select=contact_id`);
    if (t?.contact_id != null) contactos.add(String(t.contact_id));
    await borrar(`/tasks?id=eq.${encodeURIComponent(id)}`, `tarea ${id}`);
  }
  // Los que el agente creó con los datos de prueba aunque no quedaran ligados.
  for (const m of marcas) {
    if (!m.correo) continue;
    const filtro = encodeURIComponent(JSON.stringify([{ email: m.correo }]));
    for (const c of await get<{ id: number }>(`/contacts?email_jsonb=cs.${filtro}&select=id`)) contactos.add(String(c.id));
  }

  const empresas = new Set<number>();
  for (const id of contactos) {
    const [c] = await get<{
      id: number;
      company_id: number | null;
      email_jsonb?: { email?: string }[] | null;
      phone_jsonb?: { number?: string }[] | null;
      first_name?: string | null;
      last_name?: string | null;
    }>(`/contacts?id=eq.${encodeURIComponent(id)}&select=id,company_id,email_jsonb,phone_jsonb,first_name,last_name`);
    if (!c) continue;
    const datos = [...(c.email_jsonb ?? []).map((e) => e.email ?? ""), ...(c.phone_jsonb ?? []).map((p) => p.number ?? "")];
    if (!datos.some(esDatoDePrueba)) {
      r.pendientes.push(
        `Vinqulia: el contacto ${c.id} (${[c.first_name, c.last_name].filter(Boolean).join(" ")}) ya existía o no tiene datos de prueba — no se borró; revisa si le quedó una nota u oportunidad de la prueba.`,
      );
      continue;
    }
    if (c.company_id != null) empresas.add(c.company_id);
    const cid = encodeURIComponent(String(c.id));
    await borrar(`/tickets?contact_id=eq.${cid}`, `tickets del contacto ${c.id}`);
    await borrar(`/tasks?contact_id=eq.${cid}`, `tareas del contacto ${c.id}`);
    await borrar(`/contact_notes?contact_id=eq.${cid}`, `notas del contacto ${c.id}`);
    await borrar(`/deals?contact_ids=cs.${encodeURIComponent(`{${c.id}}`)}`, `oportunidades del contacto ${c.id}`);
    await borrar(`/contacts?id=eq.${cid}`, `contacto ${c.id}`);
  }

  // Una empresa solo se borra si la creó la prueba (no le queda nada más) y no es la de respaldo.
  for (const id of empresas) {
    const [e] = await get<{ name: string }>(`/companies?id=eq.${id}&select=name`);
    if (!e || e.name === "Sin empresa") continue;
    const [otroContacto] = await get(`/contacts?company_id=eq.${id}&select=id&limit=1`);
    const [otroDeal] = await get(`/deals?company_id=eq.${id}&select=id&limit=1`);
    const [otroTicket] = await get(`/tickets?company_id=eq.${id}&select=id&limit=1`);
    if (otroContacto || otroDeal || otroTicket) continue;
    await borrar(`/companies?id=eq.${id}`, `empresa "${e.name}"`);
  }
}
