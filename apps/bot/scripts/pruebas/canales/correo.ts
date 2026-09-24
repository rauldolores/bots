// Correo: de punta a punta, con correos de verdad.
//
// El cliente simulado escribe desde una dirección de prueba de un dominio que
// Resend RECIBE (mail.kontrolia.io por defecto) hacia la dirección de entrada
// del bot. El bot contesta por su camino normal, y su respuesta llega a esa
// misma dirección de prueba, donde se lee con la API de Resend. Así se prueba
// lo que ningún otro canal prueba: que llegue UNA respuesta, en el mismo
// hilo, y que a un vendedor no se le conteste.
//
// La respuesta al buzón de prueba también dispara el webhook del bot (es la
// misma cuenta de Resend). No hace eco porque va dirigida a una dirección que
// no es la de entrada del bot — por eso este canal exige que esa dirección
// esté configurada, y se niega a correr sin ella.
import { Db } from "../../../src/db/client";
import { readSecret } from "../../../src/db/vault";
import { resolveChannelEnv } from "../../../src/channels/effectiveEnv";
import type { Env } from "../../../src/env";
import type { AdaptadorCanal, SesionCanal } from "../tipos";
import { conversacionPor, dormir } from "./comun";

const API = "https://api.resend.com";

export function dominioDePrueba(env: Env): string {
  return String((env as unknown as Record<string, unknown>).PRUEBAS_DOMINIO_CORREO ?? "mail.kontrolia.io");
}

async function llaveDeResend(env: Env, botId: string): Promise<string | null> {
  const db = new Db(env.DB);
  const row = await db.first<{ secret_ref: string | null }>(
    "SELECT secret_ref FROM bot_channels WHERE bot_id = ? AND channel = 'email' AND enabled = true",
    [botId],
  );
  return row?.secret_ref ? readSecret(db, row.secret_ref) : null;
}

async function entradaDelBot(env: Env, botId: string): Promise<string> {
  const e = await resolveChannelEnv(env, botId, "email");
  return (e.EMAIL_INBOUND_ADDRESS ?? "").trim().toLowerCase();
}

/** Lo que el cliente escribió, sin la cita del correo anterior que arrastran las respuestas. */
export function sinCita(texto: string): string {
  const lineas = texto.split(/\r?\n/);
  const corte = lineas.findIndex(
    (l) => /^\s*>/.test(l) || /^(El|On)\s.+(escribió|wrote):?\s*$/i.test(l.trim()) || /^-{2,}\s*(Original|Mensaje original)/i.test(l.trim()),
  );
  return (corte === -1 ? lineas : lineas.slice(0, corte)).join("\n").trim();
}

interface Recibido {
  id: string;
  to: string[];
  subject?: string;
  created_at: string;
  message_id?: string;
}

export const correo: AdaptadorCanal = {
  canal: "correo",
  async disponible(env, botId) {
    if (!(await llaveDeResend(env, botId))) return "El correo entrante (Resend) no está conectado en este bot.";
    if (!(await entradaDelBot(env, botId)))
      return "Falta la 'Dirección a la que reenvías' en Configuración → Correo saliente: sin ella la prueba podría hacer eco.";
    return null;
  },
  async abrir({ env, botId, runId, escenario, identidad }): Promise<SesionCanal> {
    const apiKey = (await llaveDeResend(env, botId))!;
    const hacia = await entradaDelBot(env, botId);
    const desde = identidad.correo; // nodia-prueba-…@mail.kontrolia.io — ver correr.ts
    const vistos = new Set<string>();
    let hilo: { messageId?: string; asunto: string } = { asunto: escenario.asunto ?? "Consulta" };
    let enviados = 0;

    const auth = { Authorization: `Bearer ${apiKey}` };
    const recibidos = async (): Promise<Recibido[]> => {
      const r = await fetch(`${API}/emails/receiving?limit=100`, { headers: auth });
      if (!r.ok) throw new Error(`Resend GET /emails/receiving → ${r.status}`);
      const j = (await r.json()) as { data?: Recibido[] };
      return (j.data ?? []).filter((m) => (m.to ?? []).some((t) => t.toLowerCase().includes(desde)));
    };
    const contenido = async (id: string): Promise<{ text: string; message_id?: string }> => {
      const r = await fetch(`${API}/emails/receiving/${id}`, { headers: auth });
      if (!r.ok) throw new Error(`Resend GET /emails/receiving/${id} → ${r.status}`);
      return (await r.json()) as { text: string; message_id?: string };
    };

    return {
      async enviar(texto) {
        for (const m of await recibidos()) vistos.add(m.id);
        const cuerpo = escenario.firma ? `${texto}\n\n${escenario.firma}` : texto;
        const r = await fetch(`${API}/emails`, {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: desde,
            to: [hacia],
            subject: enviados === 0 ? hilo.asunto : `Re: ${hilo.asunto}`,
            text: cuerpo,
            ...(hilo.messageId ? { headers: { "In-Reply-To": hilo.messageId, References: hilo.messageId } } : {}),
          }),
        });
        if (!r.ok) throw new Error(`Resend POST /emails → ${r.status} ${await r.text()}`);
        enviados++;

        // Un correo tarda más que un chat: el buffer, el turno y la entrega.
        // Tras la primera respuesta se espera un rato más, a propósito: una
        // segunda respuesta al mismo correo es justo el error que se busca.
        const respuestas: string[] = [];
        const inicio = Date.now();
        let primera = 0;
        const limite = escenario.espera.sinRespuesta ? 120_000 : 240_000;
        while (Date.now() - inicio < limite) {
          await dormir(5000);
          for (const m of await recibidos()) {
            if (vistos.has(m.id)) continue;
            vistos.add(m.id);
            const c = await contenido(m.id);
            respuestas.push(sinCita(c.text ?? ""));
            hilo = { ...hilo, messageId: c.message_id ?? m.message_id ?? hilo.messageId };
            if (!primera) primera = Date.now();
          }
          if (primera && Date.now() - primera >= 45_000) break;
        }
        return respuestas;
      },
      conversacionId: () => conversacionPor(env, botId, "email", desde),
      async cerrar() {},
      marcas: () => ({ channel: "email", channelUserId: desde, correo: desde }),
    };
  },
};
