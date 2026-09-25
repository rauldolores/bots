// Lo que de verdad quedó registrado en la base después de una conversación de
// prueba: el juez no califica lo que el agente DICE que hizo, sino lo que hizo.
import { Db } from "../../src/db/client";
import type { Env } from "../../src/env";
import type { Evidencia } from "./tipos";
import { searchKbTool } from "../../src/tools/searchKb";

/**
 * El historial guarda cada resultado de herramienta recortado (1,500
 * caracteres, ver turn.ts), y con eso el juez reprobó una respuesta
 * CORRECTA: el precio estaba en la base, pero fuera del recorte. Para la
 * búsqueda en la base se repite la MISMA consulta que hizo el agente y se le
 * entrega al juez completa — lo que el agente tuvo a la vista.
 */
async function repetirBusqueda(env: Env, botId: string, query: string): Promise<string | null> {
  try {
    const t = searchKbTool(env, botId) as unknown as { execute: (i: { query: string }, o: unknown) => Promise<unknown> };
    const r = await t.execute({ query }, {});
    return (typeof r === "string" ? r : JSON.stringify(r)).slice(0, 6000);
  } catch {
    return null;
  }
}

export async function leerEvidencia(env: Env, botId: string, convId: string | null, correo?: string): Promise<Evidencia> {
  const db = new Db(env.DB);
  const filtrado = correo
    ? await db.first<{ categoria: string; motivo: string | null }>(
        "SELECT categoria, motivo FROM correos_filtrados WHERE bot_id = ? AND remitente = ? ORDER BY recibido_at DESC LIMIT 1",
        [botId, correo],
      )
    : null;
  if (!convId) {
    return { conversacionId: null, tickets: [], leads: [], citas: [], herramientas: [], nombreEnConversacion: null, correoFiltrado: filtrado };
  }

  const [tickets, leads, citas, mensajes, conv, eventosDeVoz] = await Promise.all([
    db.all<Evidencia["tickets"][number]>(
      "SELECT summary, requester_name, requester_contact, external_id FROM tickets WHERE bot_id = ? AND conversation_id = ?",
      [botId, convId],
    ),
    db.all<Evidencia["leads"][number]>(
      "SELECT name, contact, intent, external_id FROM leads WHERE bot_id = ? AND conversation_id = ?",
      [botId, convId],
    ),
    db.all<Evidencia["citas"][number]>(
      "SELECT starts_at, notes, external_ref FROM appointments WHERE bot_id = ? AND conversation_id = ? AND status = 'scheduled'",
      [botId, convId],
    ),
    db.all<{ tool_calls: string | null }>(
      "SELECT tool_calls FROM messages WHERE bot_id = ? AND conversation_id = ? AND tool_calls IS NOT NULL ORDER BY created_at",
      [botId, convId],
    ),
    db.first<{ display_name: string | null }>("SELECT display_name FROM conversations WHERE id = ?", [convId]),
    // En voz las herramientas no pasan por messages: quedan como eventos de la llamada.
    db.all<{ payload: unknown }>(
      `SELECT e.payload FROM voice_call_events e
       JOIN voice_sessions s ON s.id = e.call_id
       WHERE s.conversation_id = ? AND e.event_type = 'call.tool_called' ORDER BY e.occurred_at`,
      [convId],
    ),
  ]);

  const herramientas: string[] = [];
  const resultados: { herramienta: string; salida: string }[] = [];
  for (const m of mensajes) {
    try {
      for (const t of JSON.parse(m.tool_calls ?? "[]") as { toolName?: string; ok?: boolean; output?: unknown; input?: { query?: string } }[]) {
        if (t.toolName) herramientas.push(t.ok === false ? `${t.toolName} (falló)` : t.toolName);
        if (t.toolName === "searchKb" && t.input?.query) {
          const completa = await repetirBusqueda(env, botId, t.input.query);
          if (completa) {
            resultados.push({ herramienta: `searchKb("${t.input.query}")`, salida: completa });
            continue;
          }
        }
        if (t.toolName && t.output !== undefined) {
          const salida = typeof t.output === "string" ? t.output : JSON.stringify(t.output);
          resultados.push({ herramienta: t.toolName, salida: salida.slice(0, 1500) });
        }
      }
    } catch {
      /* formato viejo: se ignora */
    }
  }
  // El payload puede venir como objeto o como JSON en texto (doble
  // codificado), según el driver — igual que en verificarPromesas.ts.
  for (const e of eventosDeVoz) {
    try {
      const crudo = typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload;
      const p = (typeof crudo === "string" ? JSON.parse(crudo) : crudo) as { tool?: string; ok?: boolean };
      if (p?.tool) herramientas.push(p.ok === false ? `${p.tool} (falló)` : p.tool);
    } catch {
      /* evento ilegible: se ignora */
    }
  }

  return {
    conversacionId: convId,
    tickets,
    leads,
    citas,
    herramientas,
    resultados,
    nombreEnConversacion: conv?.display_name ?? null,
    correoFiltrado: filtrado,
  };
}
