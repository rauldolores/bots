// Qué quiso decir alguien que contestó un seguimiento — fase 4 del plan de
// JEV AI.
//
// Hoy cualquier respuesta detiene el seguimiento (nurture/run.ts, freno
// "respondio"), y está bien: una persona que contesta ya no necesita que la
// persigan. Lo que faltaba es QUÉ contestó. "Sí, mándame la cotización" y
// "gracias, ya no me interesa" apagaban el seguimiento igual, y el dueño se
// enteraba de ninguna de las dos.
//
//   - Observando: se clasifica y se anota (clasificaciones, uso "seguimiento").
//   - Activo, y solo si Jev está seguro (≥ UMBRAL_PARA_ACTUAR):
//       interesado    → aviso al dueño, que es cuando más vale llamar;
//       no_interesado → el lead pasa a "perdido" y se detienen sus
//                       seguimientos. Se puede revertir desde /admin/leads.
//     "pregunta" y "otro" no hacen nada: el bot ya le contesta en el turno.
//
// Se clasifica UNA vez por toque (la primera respuesta después de él). Lo que
// la persona diga después ya es conversación normal, no respuesta al seguimiento.
import { choice } from "@typesafe-ai/sdk";
import type { Env } from "../env";
import type { Db } from "../db/client";
import { LeadsRepo } from "../db/leads";
import { LeadTouchesRepo } from "../db/leadTouches";
import { NurtureEnrollmentsRepo } from "../db/nurtureEnrollments";
import { MessagesRepo } from "../db/messages";
import { clasificar, anotarClasificacion, estadoJev, TIEMPO_EN_SOMBRA_MS } from "./jev";
import { UMBRAL_PARA_ACTUAR } from "./preguntasJev";

const PREGUNTA = {
  intencion: choice("¿Qué responde el cliente en su `respuesta` al `seguimiento` que le mandó el negocio?", {
    interesado: "Muestra interés: quiere avanzar, pide la cotización o más información para comprar, quiere agendar o que lo contacten.",
    no_interesado: "Dice que no le interesa, que ya no lo necesita, que ya lo resolvió de otra forma o que no es el momento.",
    pregunta: "Hace una pregunta o pide un dato, sin decir todavía si le interesa.",
    otro: "Nada de lo anterior: un saludo, un 'ok', algo sin relación.",
  }),
};

export type Intencion = "interesado" | "no_interesado" | "pregunta" | "otro";

/** Lo que pasó, para quien llama (y las pruebas). Nunca lanza. */
export async function revisarRespuestaASeguimiento(
  env: Env,
  db: Db,
  botId: string,
  conversationId: string,
): Promise<{ intencion: Intencion; confianza: number; accion: "ninguna" | "aviso" | "perdido" } | null> {
  try {
    const jev = await estadoJev(env, db, botId);
    const modo = jev.modo;
    if (modo === "apagado") return null;

    const lead = await new LeadsRepo(db, botId).findByConversation(conversationId);
    if (!lead) return null;
    const enrollments = new NurtureEnrollmentsRepo(db, botId);
    if ((await enrollments.listActiveByLead(lead.id)).length === 0) return null;
    const toque = await new LeadTouchesRepo(db, botId).lastSentTouch(lead.id);
    if (!toque) return null;

    // Una vez por toque.
    const yaVisto = await db.first(
      `SELECT 1 FROM clasificaciones WHERE bot_id = ? AND uso = 'seguimiento' AND (regla #>> '{}')::jsonb->>'toque' = ?`,
      [botId, toque.id],
    );
    if (yaVisto) return null;

    // El seguimiento es el último mensaje del bot ANTES de que la persona
    // contestara; la respuesta, lo que escribió después de él.
    const historia = await new MessagesRepo(db, botId).lastN(conversationId, 12);
    const primeraRespuesta = historia.findIndex((m) => m.role === "user" && Number(m.created_at) >= Number(toque.sent_at));
    if (primeraRespuesta <= 0) return null;
    const seguimiento = [...historia.slice(0, primeraRespuesta)].reverse().find((m) => m.role === "assistant");
    const respuesta = historia
      .slice(primeraRespuesta)
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n")
      .slice(0, 1_500);
    if (!seguimiento || !respuesta.trim()) return null;

    const c = await clasificar(
      env,
      db,
      { seguimiento: seguimiento.content.slice(0, 1_500), respuesta },
      PREGUNTA,
      { botId, uso: "seguimiento", refId: conversationId, timeoutMs: TIEMPO_EN_SOMBRA_MS },
    );
    if (!c) return null;
    const intencion = c.respuestas.intencion.choice as Intencion;
    const confianza = c.respuestas.intencion.confidence;

    let accion: "ninguna" | "aviso" | "perdido" = "ninguna";
    if (jev.actuaEn("seguimientos") && confianza >= UMBRAL_PARA_ACTUAR) {
      if (intencion === "interesado") {
        const { notifyOwner } = await import("../tools/handoffHuman");
        await notifyOwner(
          env,
          {
            reason: "Respondió a tu seguimiento con interés",
            summary: `${lead.name ?? "Una persona"} contestó: «${respuesta.slice(0, 280)}». Es buen momento para darle seguimiento en persona.`,
            ticketId: `seguimiento-${toque.id}`,
            titulo: "Respuesta a un seguimiento",
            ruta: `/admin/conversations/${conversationId}`,
          },
          botId,
        );
        accion = "aviso";
      } else if (intencion === "no_interesado" && lead.status !== "sold") {
        await new LeadsRepo(db, botId).setStatus(lead.id, "lost");
        await enrollments.stopAllForLead(lead.id, "no_interesado");
        accion = "perdido";
      }
    }

    await anotarClasificacion(db, botId, {
      uso: "seguimiento",
      refId: conversationId,
      modo: jev.actuaEn("seguimientos") ? "activo" : "sombra",
      clasificacion: c,
      regla: { toque: toque.id, secuencia: toque.sequence_id, accion },
    });
    return { intencion, confianza, accion };
  } catch (e) {
    console.warn("[seguimiento] no se pudo revisar la respuesta:", e instanceof Error ? e.message : e);
    return null;
  }
}
