/**
 * Qué aprendimos de esta conversación, y qué habría hecho un buen operador.
 *
 * Corre DESPUÉS de responderle al cliente, no durante: es una llamada al LLM
 * completa y nadie la está esperando. Esa fue la clave que destrabó todo esto —
 * el análisis puede darse el lujo de ser caro porque ya nadie mira el reloj.
 *
 * Lo que sale de aquí NO se ejecuta: se encola para que el dueño lo apruebe
 * (src/db/crmProposals.ts). El modelo razona; el código decide.
 */
import { generateObject } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { createModel } from "../llm/provider";
import { loadLlmOverrides } from "../settings-loader";
import { MessagesRepo } from "../db/messages";
import { CrmProposalsRepo } from "../db/crmProposals";
import { buildCustomerContext } from "../customer/context";
import { proponerDesdeAnalisis } from "./proponer";

/** Tras estos intentos se abandona: el cliente ya fue atendido y la conversación sigue en la bandeja. */
const MAX_INTENTOS = 3;
/** Espera antes de reintentar un análisis fallido. */
const REINTENTO_MS = 5 * 60_000;

/** Cuántos mensajes del final se analizan. Lo reciente es lo que trae información nueva. */
const MENSAJES_A_ANALIZAR = 12;

/**
 * El esquema es el corazón de esto.
 *
 * Aquí vive la mayor parte de lo que antes se pedía en prosa dentro del prompt:
 * en vez de rogarle al modelo que "detecte información nueva sobre industria,
 * presupuesto, decisor…", se le pide que llene campos. Un modelo llena campos
 * mucho mejor de lo que sigue procedimientos.
 *
 * Todo opcional a propósito: una conversación de la que no se aprende nada
 * debe poder devolver un objeto vacío, no inventar.
 */
const AnalisisSchema = z.object({
  contacto: z
    .object({
      nombre: z.string().optional().describe("Nombre completo SOLO si lo dijo en esta conversación"),
      cargo: z.string().optional().describe("Su puesto, ej. 'Director de operaciones'"),
      email: z.string().optional(),
      telefono: z.string().optional(),
    })
    .optional(),
  empresa: z
    .object({
      nombre: z.string().optional(),
      industria: z.string().optional().describe("A qué se dedica, ej. 'distribución de alimentos'"),
      tamano: z.number().optional().describe("Número de empleados o usuarios, si lo mencionó"),
    })
    .optional(),
  interaccion: z.object({
    intencion: z
      .enum(["ventas", "soporte", "facturacion", "seguimiento", "queja", "consulta", "otro"])
      .describe("De qué se trató principalmente"),
    resumen: z
      .string()
      .describe(
        "2-3 líneas para un operador humano: hechos, decisiones, objeciones y próximo paso. Nada de relleno.",
      ),
  }),
  oportunidad: z
    .object({
      interes: z.string().optional().describe("Qué producto o servicio le interesa"),
      valorEstimado: z.number().optional().describe("Presupuesto o monto que él mencionó, nunca inventado"),
      objeciones: z.array(z.string()).optional().describe("Ej. 'precio', 'no es el momento'"),
    })
    .optional(),
  compromisos: z
    .array(
      z.object({
        que: z.string().describe("Qué se prometió, ej. 'enviar propuesta'"),
        cuando: z.string().optional().describe("Cuándo, tal como se dijo: 'el martes', 'mañana'"),
        deQuien: z.enum(["nosotros", "cliente"]),
      }),
    )
    .optional()
    .describe("Solo compromisos EXPLÍCITOS. 'Lo pienso' no es un compromiso."),
  etiquetas: z
    .array(z.string())
    .optional()
    .describe("2-4 etiquetas comerciales en kebab-case, ej. 'lead-caliente', 'objecion-precio'"),
  contradicciones: z
    .array(
      z.object({
        campo: z.string(),
        loQueDijo: z.string(),
      }),
    )
    .optional()
    .describe("Cuando lo dicho choca con lo que ya sabías del cliente. NO lo resuelvas, solo repórtalo."),
});

export type AnalisisCrm = z.infer<typeof AnalisisSchema>;

/**
 * Analiza una conversación y encola lo que valga la pena.
 *
 * Nunca lanza: es trabajo posterior. Que falle no le quita nada al cliente,
 * que ya fue atendido.
 */
export async function analizarConversacion(
  env: Env,
  botId: string,
  conversationId: string,
): Promise<{ propuestas: number } | null> {
  {
    const db = new Db(env.DB);
    const historia = await new MessagesRepo(db, botId).lastN(conversationId, MENSAJES_A_ANALIZAR);
    if (historia.length < 2) return null; // un saludo suelto no da para analizar

    const cliente = await buildCustomerContext(db, botId, { conversationId });

    const transcripcion = historia
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => `${m.role === "user" ? "Cliente" : "Agente"}: ${m.content.slice(0, 600)}`)
      .join("\n");

    const yaSabido = [
      cliente.lead?.name ? `nombre: ${cliente.lead.name}` : null,
      cliente.lead?.contact ? `contacto: ${cliente.lead.contact}` : null,
      cliente.crm?.empresa ? `empresa: ${cliente.crm.empresa.nombre}` : null,
      cliente.crm?.empresa?.industria ? `industria: ${cliente.crm.empresa.industria}` : null,
      cliente.crm?.cargo ? `cargo: ${cliente.crm.cargo}` : null,
    ]
      .filter(Boolean)
      .join("; ");

    const { model } = createModel(env, "fast", await loadLlmOverrides(env, botId));
    const { object } = await generateObject({
      model,
      schema: AnalisisSchema,
      prompt: `Eres un operador comercial revisando una conversación que acaba de terminar, para dejar el CRM al día.

${yaSabido ? `Lo que YA sabíamos de este cliente: ${yaSabido}\nNo repitas nada de eso — solo reporta lo NUEVO o lo que lo contradiga.` : "No teníamos nada registrado de este cliente."}

Conversación:
${transcripcion}

Reporta ÚNICAMENTE lo que el cliente dijo de forma explícita. No deduzcas, no completes huecos, no inventes montos ni fechas. Si de esta conversación no se aprende nada nuevo, deja los campos vacíos — eso es una respuesta válida y preferible a inventar.`,
    });

    const propuestas = await proponerDesdeAnalisis(db, botId, {
      analisis: object,
      conversationId,
      cliente,
    });
    // Se registra SIEMPRE, incluido el cero: "no propuso nada" y "falló en
    // silencio" se veían idénticos desde fuera, y eso costó una tarde de
    // diagnóstico a ciegas.
    console.log(`[crmAnalisis] conv ${conversationId}: ${propuestas} propuesta(s) en cola`);
    return { propuestas };
  }
}

export { AnalisisSchema };

/**
 * Procesa los análisis pendientes en la cola. Lo llama el tick, DESPUÉS de
 * haber contestado todos los turnos — nunca antes.
 */
export async function processCrmAnalysisJobs(env: Env, limit: number): Promise<{ analizadas: number }> {
  const db = new Db(env.DB);
  const { WorkJobsRepo } = await import("../db/workJobs");
  const repo = new WorkJobsRepo(db);
  const trabajos = await repo.claimDue(limit, "crm_analysis");
  let analizadas = 0;

  for (const t of trabajos) {
    const conversationId = String(t.payload?.conversationId ?? "");
    try {
      if (conversationId) {
        await analizarConversacion(env, t.bot_id, conversationId);
        analizadas++;
      }
      await repo.complete(t.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[crmAnalisis] trabajo ${t.id} falló:`, msg);
      // El error QUEDA en la fila (work_jobs.last_error), no solo en un log
      // que puede no capturarse. Antes se borraba el trabajo pasara lo que
      // pasara, así que un análisis roto y uno que no encontró nada se veían
      // exactamente igual desde fuera: la cola vacía.
      if (t.attempts >= MAX_INTENTOS) {
        console.error(`[crmAnalisis] ${t.id} abandonado tras ${t.attempts} intentos`);
        await repo.complete(t.id).catch(() => {});
      } else {
        await repo.fail(t.id, msg, REINTENTO_MS).catch(() => {});
      }
    }
  }
  return { analizadas };
}
