/**
 * Qué aprendimos de esta conversación, y qué habría hecho un buen operador.
 *
 * Corre DESPUÉS de responderle al cliente, no durante: es una llamada al LLM
 * completa y nadie la está esperando. Esa fue la clave que destrabó todo esto —
 * el análisis puede darse el lujo de ser caro porque ya nadie mira el reloj.
 *
 * Lo que sale de aquí no se escribe directo: pasa por la cola de propuestas
 * (src/db/crmProposals.ts), y de ahí el código decide qué se aplica solo y qué
 * espera al dueño — riesgo bajo y medio van solos, el alto siempre pregunta
 * (ver aplicarAutomaticas en ./ejecutar.ts). El modelo razona; el código
 * decide.
 */
import { generateObject } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { createModel } from "../llm/provider";
import { loadLlmOverrides } from "../settings-loader";
import { MessagesRepo } from "../db/messages";
import { ConversationsRepo } from "../db/conversations";
import { CrmProposalsRepo } from "../db/crmProposals";
import { buildCustomerContext } from "../customer/context";
import { proponerDesdeAnalisis } from "./proponer";
import { aplicarAutomaticas, crmQueRecibeCambios } from "./ejecutar";

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
 * Todo puede venir en null a propósito: una conversación de la que no se
 * aprende nada debe poder no reportar nada, en vez de inventar.
 *
 * Va `.nullable()` y NO `.optional()`: el modo estricto de OpenAI exige que
 * TODA propiedad esté en `required`, así que un solo campo opcional tumba la
 * llamada entera con "Missing 'nombre'". Como el análisis corre fuera del
 * turno, nadie lo notaba: la cola de propuestas se quedaba vacía para
 * siempre. "No sé" se dice con null, no con ausencia — lo cuida
 * test/crm/analisisSchema.test.ts.
 */
const AnalisisSchema = z.object({
  contacto: z
    .object({
      nombre: z.string().nullable().describe("Nombre completo SOLO si lo dijo en esta conversación"),
      cargo: z.string().nullable().describe("Su puesto, ej. 'Director de operaciones'"),
      email: z.string().nullable(),
      telefono: z.string().nullable(),
    })
    .nullable(),
  empresa: z
    .object({
      nombre: z.string().nullable(),
      industria: z.string().nullable().describe("A qué se dedica, ej. 'distribución de alimentos'"),
      tamano: z.number().nullable().describe("Número de empleados o usuarios, si lo mencionó"),
    })
    .nullable(),
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
      interes: z.string().nullable().describe("Qué producto o servicio le interesa"),
      valorEstimado: z.number().nullable().describe("Presupuesto o monto que él mencionó, nunca inventado"),
      objeciones: z.array(z.string()).nullable().describe("Ej. 'precio', 'no es el momento'"),
    })
    .nullable(),
  compromisos: z
    .array(
      z.object({
        que: z.string().describe("Qué se prometió, ej. 'enviar propuesta'"),
        cuando: z.string().nullable().describe("Cuándo, tal como se dijo: 'el martes', 'mañana'"),
        deQuien: z.enum(["nosotros", "cliente"]),
      }),
    )
    .nullable()
    .describe("Solo compromisos EXPLÍCITOS. 'Lo pienso' no es un compromiso."),
  etiquetas: z
    .array(z.string())
    .nullable()
    .describe("2-4 etiquetas comerciales en kebab-case, ej. 'lead-caliente', 'objecion-precio'"),
  contradicciones: z
    .array(
      z.object({
        campo: z.string(),
        loQueDijo: z.string(),
      }),
    )
    .nullable()
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

    // Sin un CRM que sepa RECIBIR los cambios, analizar no tiene destino: la
    // propuesta nacería condenada a fallar. Y esto no es gratis — es una
    // llamada entera al LLM por conversación. Antes no se preguntaba, así que
    // un bot sin CRM (o con HubSpot/Pipedrive, que todavía no saben aplicar)
    // pagaba el análisis y además se le llenaba /admin/mejoras de fallidas.
    if (!(await crmQueRecibeCambios(env, db, botId))) return null;

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
      // El canal es lo que hace que una llamada quede registrada COMO llamada
      // en el CRM, y no como una nota más — ver crm/tiposDeNota.ts.
      canal: (await new ConversationsRepo(db, botId).getById(conversationId))?.channel ?? null,
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
  // Los bots que tuvieron movimiento en esta corrida. Solo a ellos se les
  // revisa la cola después: nada de barrer la base entera cada minuto.
  const conMovimiento = new Set<string>();

  for (const t of trabajos) {
    const conversationId = String(t.payload?.conversationId ?? "");
    try {
      if (conversationId) {
        await analizarConversacion(env, t.bot_id, conversationId);
        analizadas++;
        conMovimiento.add(t.bot_id);
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

  // Y se escribe en el CRM lo que no necesita permiso. Va DESPUÉS de analizar
  // todo, no dentro del bucle: así una sola pasada ordena bien las propuestas
  // de la misma conversación (la empresa antes que sus campos), y un fallo
  // escribiendo no le quita su análisis a nadie.
  for (const botId of conMovimiento) {
    try {
      const r = await aplicarAutomaticas(env, db, botId);
      if (r.aplicadas || r.fallidas || r.enEspera) {
        console.log(
          `[crmAnalisis] bot ${botId}: ${r.aplicadas} aplicada(s) sola(s), ${r.fallidas} fallida(s), ${r.enEspera} esperando visto bueno`,
        );
      }
    } catch (e) {
      console.error(`[crmAnalisis] aplicarAutomaticas de ${botId}:`, e);
    }
  }
  return { analizadas };
}
