// Cuánto cuesta de verdad una conversación.
//
// Antes solo se podía estimar: Costos sumaba los tokens de las RESPUESTAS
// (tabla messages) y nada más. Pero una conversación gasta también DESPUÉS de
// contestar — el análisis que deja el CRM al día, el del analista de
// conversaciones, los seguimientos a quien dejó de responder — y esas
// llamadas no se registraban en ningún lado. Ahora van a ai_usage con la
// conversación como ref_id (ver registrarUso en db/aiUsage.ts), y aquí se
// juntan las tres fuentes:
//
//   respuestas   messages.model_used + tokens          (lo que ve el cliente)
//   después      ai_usage source crm | analisis        (lo que se piensa al cerrar)
//   seguimientos ai_usage source seguimiento | nurture  (volver a escribirle)
//   voz          voice_sessions, en dólares ESTIMADOS   (ElevenLabs + telefonía)
//
// Lo que no pertenece a una conversación de un cliente —borradores de la base
// de conocimiento, habilidades por API, lo que el dueño dispara desde el
// panel, el sandbox de entrenamiento— se reporta aparte como "fuera de
// conversaciones", para que sume al total sin inflar el promedio.
import type { Db } from "../db/client";
import { costOfUsage, type ModelId } from "../pricing";

export type Concepto = "respuestas" | "despues" | "seguimientos" | "voz";

export interface CostoPorConversacion {
  /** Conversaciones de clientes con actividad del bot en la ventana (sin el sandbox). */
  conversaciones: number;
  totalUsd: number;
  promedioUsd: number;
  medianaUsd: number;
  desglose: Record<Concepto, number>;
  /** Gasto de IA que no es de ninguna conversación de cliente. */
  fueraDeConversacionesUsd: number;
  masCaras: Array<{ id: string; canal: string; nombre: string | null; usd: number }>;
}

const CONCEPTO_DE_FUENTE: Record<string, Concepto | undefined> = {
  crm: "despues",
  analisis: "despues",
  seguimiento: "seguimientos",
  nurture: "seguimientos",
};

function mediana(valores: number[]): number {
  if (!valores.length) return 0;
  const v = [...valores].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export async function costoPorConversacion(db: Db, botId: string, desdeMs: number): Promise<CostoPorConversacion> {
  const [respuestas, usos, voces] = await Promise.all([
    db.all<{ conv: string; canal: string; nombre: string | null; model_used: string; input: number; output: number; cached: number }>(
      `SELECT m.conversation_id AS conv, c.channel AS canal, c.display_name AS nombre, m.model_used,
              SUM(COALESCE(m.input_tokens, 0)) AS input,
              SUM(COALESCE(m.output_tokens, 0)) AS output,
              SUM(COALESCE(m.cached_input_tokens, 0)) AS cached
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE m.bot_id = ? AND m.created_at > ? AND m.model_used IS NOT NULL
        GROUP BY m.conversation_id, c.channel, c.display_name, m.model_used`,
      [botId, desdeMs],
    ),
    db.all<{ ref: string | null; source: string; model_used: string; input: number; output: number; cached: number }>(
      `SELECT ref_id AS ref, source, model_used,
              SUM(COALESCE(input_tokens, 0)) AS input,
              SUM(COALESCE(output_tokens, 0)) AS output,
              SUM(COALESCE(cached_input_tokens, 0)) AS cached
         FROM ai_usage
        WHERE bot_id = ? AND created_at > ?
        GROUP BY ref_id, source, model_used`,
      [botId, desdeMs],
    ),
    db.all<{ conv: string; canal: string; nombre: string | null; usd: number }>(
      `SELECT v.conversation_id AS conv, c.channel AS canal, c.display_name AS nombre,
              SUM(COALESCE(v.estimated_ai_cost_usd, 0) + COALESCE(v.estimated_telephony_cost_usd, 0))::float8 AS usd
         FROM voice_sessions v
         JOIN conversations c ON c.id = v.conversation_id
        WHERE v.bot_id = ? AND v.started_at > ?
        GROUP BY v.conversation_id, c.channel, c.display_name`,
      [botId, desdeMs],
    ),
  ]);

  const porConv = new Map<string, { canal: string; nombre: string | null; usd: number }>();
  const desglose: Record<Concepto, number> = { respuestas: 0, despues: 0, seguimientos: 0, voz: 0 };
  let fuera = 0;

  const sumar = (conv: string, canal: string, nombre: string | null, usd: number) => {
    const actual = porConv.get(conv) ?? { canal, nombre, usd: 0 };
    actual.usd += usd;
    porConv.set(conv, actual);
  };

  // El sandbox de entrenamiento es el dueño probando su bot: cuesta, pero no
  // es una conversación de cliente — promediarla falsearía el número.
  for (const r of respuestas) {
    const usd = costOfUsage(r.model_used as ModelId, { input: Number(r.input), output: Number(r.output), cached: Number(r.cached) });
    if (r.canal === "training") {
      fuera += usd;
      continue;
    }
    desglose.respuestas += usd;
    sumar(r.conv, r.canal, r.nombre, usd);
  }
  for (const v of voces) {
    const usd = Number(v.usd) || 0;
    desglose.voz += usd;
    sumar(v.conv, v.canal, v.nombre, usd);
  }
  // ai_usage va al final: solo se atribuye a una conversación que ya está en
  // el mapa (de un cliente, con actividad en la ventana). Una ref a otra cosa
  // —el sandbox, una habilidad, nada— es gasto fuera de conversaciones.
  for (const u of usos) {
    // La voz ya se contó arriba, en dólares, desde voice_sessions. Si algún
    // día también se registra en ai_usage, contarla dos veces duplicaría justo
    // el concepto más caro.
    if (u.source === "voice") continue;
    const usd = costOfUsage(u.model_used as ModelId, { input: Number(u.input), output: Number(u.output), cached: Number(u.cached) });
    const concepto = CONCEPTO_DE_FUENTE[u.source];
    const conv = u.ref ? porConv.get(u.ref) : undefined;
    if (concepto && conv) {
      desglose[concepto] += usd;
      conv.usd += usd;
    } else {
      fuera += usd;
    }
  }

  const costos = [...porConv.values()].map((c) => c.usd);
  const totalConv = costos.reduce((a, b) => a + b, 0);
  const masCaras = [...porConv.entries()]
    .map(([id, c]) => ({ id, canal: c.canal, nombre: c.nombre, usd: c.usd }))
    .sort((a, b) => b.usd - a.usd)
    .slice(0, 5);

  return {
    conversaciones: porConv.size,
    totalUsd: totalConv + fuera,
    promedioUsd: porConv.size ? totalConv / porConv.size : 0,
    medianaUsd: mediana(costos),
    desglose,
    fueraDeConversacionesUsd: fuera,
    masCaras,
  };
}
