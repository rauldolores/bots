// Widget: por su API pública, la misma que usa el script en la web del cliente
// (POST /widget/message y GET /widget/messages). Es la prueba más fiel de
// todas: no hay nada simulado entre el "visitante" y el agente.
import { Db } from "../../../src/db/client";
import type { AdaptadorCanal, SesionCanal } from "../tipos";
import { conversacionPor, dormir } from "./comun";

async function llaveDelWidget(db: Db, botId: string): Promise<string | null> {
  const row = await db.first<{ external_id: string | null }>(
    "SELECT external_id FROM bot_channels WHERE bot_id = ? AND channel = 'widget' AND enabled = true",
    [botId],
  );
  return row?.external_id ?? null;
}

export const widget: AdaptadorCanal = {
  canal: "widget",
  async disponible(env, botId) {
    return (await llaveDelWidget(new Db(env.DB), botId)) ? null : "El widget no está conectado en este bot.";
  },
  async abrir({ env, botId, runId, escenario, baseUrl }): Promise<SesionCanal> {
    const key = (await llaveDelWidget(new Db(env.DB), botId))!;
    const sessionId = `nodia-prueba-${runId}-${escenario.id}`;
    let ultimo = 0;

    const leer = async () => {
      const u = new URL(`${baseUrl}/widget/messages`);
      u.searchParams.set("bot", botId);
      u.searchParams.set("key", key);
      u.searchParams.set("sessionId", sessionId);
      u.searchParams.set("after", String(ultimo));
      const r = await fetch(u);
      if (!r.ok) throw new Error(`GET /widget/messages → ${r.status}`);
      const j = (await r.json()) as { messages: { role: string; content: string; created_at: number }[] };
      return j.messages;
    };

    return {
      async enviar(texto) {
        // Todo lo anterior ya se vio: la respuesta es lo que llegue después.
        for (const m of await leer()) ultimo = Math.max(ultimo, Number(m.created_at));
        const r = await fetch(`${baseUrl}/widget/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ botId, key, sessionId, text: texto }),
        });
        if (!r.ok) throw new Error(`POST /widget/message → ${r.status} ${await r.text()}`);

        const respuestas: string[] = [];
        const inicio = Date.now();
        let ultimoNuevo = 0;
        while (Date.now() - inicio < 150_000) {
          await dormir(2500);
          for (const m of await leer()) {
            ultimo = Math.max(ultimo, Number(m.created_at));
            if (m.role === "assistant" && m.content.trim()) {
              respuestas.push(m.content);
              ultimoNuevo = Date.now();
            }
          }
          if (respuestas.length > 0 && Date.now() - ultimoNuevo >= 8_000) break;
        }
        return respuestas;
      },
      conversacionId: () => conversacionPor(env, botId, "widget", sessionId),
      async cerrar() {},
      marcas: () => ({ channel: "widget", channelUserId: sessionId }),
    };
  },
};
