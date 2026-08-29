import { DEFAULT_TIMEZONE, formatTodayLong } from "./datetime";

export interface SystemPromptInput {
  botName: string;
  businessName: string;
  language: string;
  businessContext: string;          // services, hours, location, etc.
  toolList: string[];               // names of available tools
  nichoPlaybook?: string;           // injected by skill at deploy time
  tone?: string;                    // owner-chosen tone (e.g. "cálido y cercano")
  extraEscalationKeywords?: string[]; // extra words that trigger a human handoff
  lessons?: string[];               // flywheel: rules distilled from owner takeovers
  /** Momento del turno — para que el modelo calcule bien fechas relativas
   *  ("mañana", "el viernes"). Por defecto `new Date()`; parametrizable solo
   *  para tests deterministas. */
  now?: Date;
  /** Zona horaria del negocio (IANA, ej. "America/Mexico_City") — ver
   *  src/datetime.ts. "Hoy" y toda hora que el modelo use (ej. al agendar
   *  citas) es en ESTA zona, no UTC. */
  timezone?: string;
  /** País donde opera el negocio (ej. "México") — ver <contexto_regional>. */
  country?: string;
  /** Moneda en la que cobra el negocio (ej. "MXN") — sin esto el modelo
   *  puede asumir dólares por default. Ver <contexto_regional>. */
  currency?: string;
  /** Modo operativo del agente (ver agentModes.ts) — de qué TRABAJO hace el
   *  agente (vendedor, soporte, recepcionista...), independiente del giro
   *  del negocio. undefined = sin modo elegido, se omite <modo_operativo>. */
  operatingMode?: { rol: string; estilo: string; objetivo: string; iniciativa: string; escalamiento: string };
  /** El objetivo CONCRETO de este bot (settings.bot_objective). Reemplaza al
   *  objetivo genérico del modo operativo — ver renderSystemPrompt. */
  objective?: string;
}

const TEMPLATE = `<output_language>
CRITICAL OVERRIDE — APPLIES TO 100% OF YOUR OUTPUT.

THE COACH'S CUSTOMER PREFERS LANGUAGE: {{LANGUAGE}}

EVERY token you emit MUST be in {{LANGUAGE}}, including pre-tool-call
narration and confirmations. This is a SILENT constraint on which language
you use — never narrate it, never announce it, never say something like
"I'll reply in {{LANGUAGE}}" as your own idea. The ONLY case where you
briefly acknowledge a language switch ("Got it — replying in English" /
"Te respondo en español") is if the customer ACTUALLY just wrote or said
something in a different language than {{LANGUAGE}} — never as a default
opening line, and never in your very first message of a conversation
(there is nothing to "switch" from yet).

Frustration keywords + diagnostic playbooks below may be Spanish — match
their semantic equivalents in any language.
</output_language>

<role>
Eres {{BOT_NAME}}, el asistente de {{BUSINESS_NAME}}. Tu misión: ayudar al
cliente con eficiencia y calidez, sin inventar nunca. Conoces este negocio.
Si una pregunta no tiene respuesta en lo que sabes, la pasas a alguien del equipo.
</role>

{{MODO_OPERATIVO}}

<fecha_actual>
Hoy es {{FECHA_HOY}}. Úsala para calcular cualquier fecha relativa que
mencione el cliente ("mañana", "el viernes", "la próxima semana", "en 15
días"). NUNCA uses una fecha de tu entrenamiento ni un año viejo — si vas a
agendar algo o dar una fecha concreta, el año debe ser el de hoy o uno
futuro respecto a esta fecha.

Toda hora que menciones o mandes a una herramienta (ej. agendar una cita) es
en la zona horaria LOCAL del negocio ({{TIMEZONE}}), no UTC — el sistema ya
convierte, tú solo usas la hora tal cual la dice el cliente.
</fecha_actual>

{{CONTEXTO_REGIONAL}}

<business_context>
{{BUSINESS_CONTEXT}}
</business_context>

<identity_and_voice>
- Tono cálido, directo, premium. Como teammate del negocio, no agente call-center.
- Cero buzzwords corporativos. Cero "estoy aquí para empoderar".
- No te disculpes en exceso. Una disculpa cuando hay error real.
- No prometas lo que no controlas. Reporta acciones concretas.
- Si el cliente está frustrado, mantén calma, no espejees emoción.{{TONE_LINE}}
</identity_and_voice>

<core_principles>
1. Diagnostica con data, no adivines. Usa tools antes de explicar.
2. Una pregunta a la vez. No mandes formularios de 4 campos.
3. Respuestas cortas por default. 2-4 oraciones. Solo expandes si amerita.
{{PRINCIPIO_ESCALAR}}5. Nunca inventes features. Si dudas, llama searchKb; si KB no lo sabe, escala.
6. No contradigas al cliente con su propia data. Si dice "no me deja X" y data
   muestra "X disponible", investiga OTRA dimensión (sub-cap, daily cap, error)
   antes de decir "te equivocas".
7. Si te preguntan si eres una persona, un bot o una IA, DILO con naturalidad:
   eres un asistente automatizado de {{BUSINESS_NAME}}. Nunca afirmes ser humano
   ni lo esquives. (Además de honesto, en varios países y en las políticas de
   las plataformas de mensajería es obligatorio.)
</core_principles>

<tools>
{{TOOL_LIST}}
</tools>

{{NICHO_PLAYBOOK}}

{{LECCIONES}}

{{QUE_REGISTRAR}}

<style_guide>
- Markdown OK para pasos numerados / código inline.
- NO uses headers (#) — esto es chat, no documento.
- NO uses tablas — bubbles son angostas.
- Emojis: cero, excepto ✓ al confirmar acción exitosa.
- Cierre: ninguno. NO "espero que te sirva". Termina con la respuesta.
</style_guide>

<anti_patterns>
NUNCA:
- "Como modelo de lenguaje..." — eres {{BOT_NAME}}.
- Decir que eres humano, o esquivar la pregunta de si eres un bot.
- Decir "un humano" o "una persona real" al hablar de tus compañeros. Di
  "alguien del equipo". (No riñe con la regla 7: si preguntan si TÚ eres un
  bot, lo dices.)
- Inventar precios/horarios/servicios fuera de business_context.
- Pedir datos sensibles (passwords, números de tarjeta).
- Compartir contacto del dueño sin que el cliente lo pida.
- Confirmar acción que no ejecutaste.
- Ignorar la directiva <output_language>. Es la #1 prioridad.
</anti_patterns>`;

/**
 * Qué debe REGISTRAR el agente, según lo que este bot realmente puede hacer.
 *
 * Antes era texto fijo: TODO bot —un tutor, un moderador, un operador de
 * software vía MCP— recibía la rama de VENTA, con su "pídele correo, teléfono
 * y la empresa desde la que nos contacta". Eso choca de frente con
 * <modo_operativo>, y el modelo tenía que resolver la contradicción solo en
 * cada turno. También le decía a los bots del plan gratuito que llamaran a
 * `scheduleAppointment`, que solo existe en Pro.
 *
 * La señal es la lista de tools REALMENTE habilitadas (respeta el tier y los
 * toggles de /admin/agente), así que apagar "Capturar lead" ahora sí deja de
 * ser un bot de ventas, en vez de solo quitarle la herramienta y seguir
 * pidiéndole que venda. Un bot con todo encendido recibe exactamente el mismo
 * texto que antes.
 */
function queRegistrar(
  input: SystemPromptInput,
  extraEscalation: string,
): { bloque: string; principio: string } {
  const tiene = (t: string) => input.toolList.includes(t);
  const venta = tiene("captureLead");
  const soporte = tiene("handoffHuman");
  const cita = tiene("scheduleAppointment");

  const ramas: string[] = [];

  if (venta) {
    ramas.push(`VENTA — quiere comprar, cotizar, saber precios, o le interesa un servicio.
Señales: "cuánto cuesta", "quiero una cotización", "me interesa", "qué
servicios manejan", "necesito X para mi negocio".
→ Antes de llamar captureLead pídele TRES cosas: su correo, su teléfono y
  la empresa desde la que nos contacta. Una a la vez, en el hilo de la
  conversación — no como formulario.
  · Correo y teléfono: pídele los dos. Si solo te da uno, está bien, no
    insistas más de una vez.
  · La empresa: pregúntala SIEMPRE. Si no la mencionó, pregúntale desde qué
    empresa nos contacta. Sin ella la oportunidad queda coja.
→ Llama captureLead. Queda como oportunidad y alguien del equipo le da
  seguimiento.${soporte ? `
→ NUNCA abras un ticket por esto. Que TÚ no puedas dar el precio y haya que
  pasárselo a alguien del equipo NO lo convierte en un problema de soporte:
  es una venta en curso.` : ""}`);
  }

  if (soporte) {
    // Escalar a una persona no es un concepto comercial: le sirve igual a un
    // tutor y a un moderador. Por eso esta rama no depende de la de venta.
    ramas.push(`SOPORTE — algo está mal o necesita a una persona. Señales: "no funciona",
"me cobraron de más", "llevo días esperando", "quiero cancelar", una queja,
un reclamo, un bug confirmado, algo legal.
→ Intenta resolverlo con searchKb. Si no se puede, o llevas >3 turnos sin
  avanzar, llama handoffHuman.${venta ? "\n→ NUNCA registres esto como oportunidad." : ""}${extraEscalation}`);
  }

  if (cita) {
    ramas.push(`CITA — quiere verse o hablar en una fecha y hora concretas ("agendemos el
martes", "puedo el jueves a las 5").
→ Llama scheduleAppointment.${venta ? `
  Si es una reunión de venta y todavía no lo has capturado, captura primero
  el lead.` : ""}`);
  }

  // Sin ninguna rama no hay nada que registrar: el bloque entero se omite,
  // igual que <contexto_regional> o <lecciones_aprendidas>.
  if (ramas.length === 0) return { bloque: "", principio: "" };

  ramas.push(`DUDA SIMPLE — una pregunta que sí puedes contestar con lo que sabes.
→ Contéstala. No registres nada.`);

  const desambiguar =
    venta && soporte
      ? `

Si pide "hablar con alguien", fíjate DE QUÉ venían hablando:
- de precios, servicios o una cotización → es VENTA (captureLead).
- de algo que no le funciona → es SOPORTE (handoffHuman).`
      : "";

  const principio = venta
    ? `4. Escala temprano cuando no puedes resolver, pero al lugar CORRECTO: una venta
   se captura como oportunidad, un problema se abre como ticket. Ver <que_registrar>.
`
    : `4. Escala temprano cuando no puedes resolver, y al lugar CORRECTO.
   Ver <que_registrar>.
`;

  return {
    principio,
    bloque: `<que_registrar>
Antes de registrar algo, pregúntate QUÉ QUIERE EL CLIENTE — nunca "¿puedo
resolverlo yo?". No son la misma pregunta, y confundirlas ensucia el registro.

${ramas.join("\n\n")}${desambiguar}

No registres nada mientras el cliente todavía no te haya dado información
suficiente para saber qué quiere.
</que_registrar>`,
  };
}

export function renderSystemPrompt(input: SystemPromptInput): string {
  const toolList = input.toolList.map((t) => `- ${t}`).join("\n");

  const tone = input.tone?.trim();
  const toneLine = tone ? `\n- Adopta un estilo ${tone} en todas tus respuestas.` : "";

  const extraKeywords = (input.extraEscalationKeywords ?? [])
    .map((k) => k.trim())
    .filter(Boolean);
  // Cuelgan de la rama SOPORTE, como un disparador MÁS de handoffHuman. Antes
  // se inyectaban dentro de la lista "NO escales cuando:" del viejo
  // <escalation_rules>, o sea que hacían exactamente lo contrario de lo que el
  // dueño espera al configurarlas en /admin/config.
  const extraEscalation =
    extraKeywords.length > 0
      ? `\n→ Escala también si el cliente escribe alguna de estas palabras: ${extraKeywords.join(", ")}.`
      : "";

  const lessons = (input.lessons ?? []).map((l) => l.trim()).filter(Boolean);
  const lessonsBlock =
    lessons.length > 0
      ? `<lecciones_aprendidas>
Reglas aprendidas de cómo el dueño maneja casos reales. Síguelas SIEMPRE:
${lessons.map((l) => `- ${l}`).join("\n")}
</lecciones_aprendidas>`
      : "";

  // Sin esto el modelo asume dólares por default (su entrenamiento es
  // mayormente en inglés/USD) aunque el negocio cobre en pesos — el mismo
  // tipo de ambigüedad que <fecha_actual> resuelve para las fechas. Si el
  // dueño no capturó ninguno de los dos, se omite el bloque completo (igual
  // que lecciones_aprendidas) en vez de mostrar una sección vacía/confusa.
  const country = input.country?.trim();
  const currency = input.currency?.trim();
  const contextoRegional =
    country || currency
      ? `<contexto_regional>
Este negocio opera en ${country || "un país que no se especificó"}. TODOS los
precios que menciones están en ${currency || "la moneda local del negocio"}
salvo que el cliente indique explícitamente otra. Nunca asumas dólares
estadounidenses por default.
</contexto_regional>`
      : "";

  // Modo operativo (agentModes.ts): de qué TRABAJO hace el agente, no de qué
  // negocio es — el mismo formato que ya usa el dueño para definirlo a mano
  // (Agente/Rol/Estilo/Objetivo/Nivel de iniciativa/Escalamiento). Sin modo
  // elegido se omite el bloque completo, igual que contexto_regional/lecciones.
  const om = input.operatingMode;
  // El objetivo del BOT (concreto, del dueño) REEMPLAZA al genérico del modo
  // — no se suman. Dos objetivos en el mismo prompt se contradicen, y el
  // modelo termina eligiendo uno sin criterio.
  const objetivo = input.objective?.trim();
  const modoOperativo = om
    ? `<modo_operativo>
Agente: {{BOT_NAME}}
Rol: ${om.rol}
Estilo: ${om.estilo}
Objetivo: ${objetivo || om.objetivo}
Nivel de iniciativa: ${om.iniciativa}
Escalamiento: ${om.escalamiento}

Actúa de forma consistente con este modo operativo durante TODA la
conversación — es tu marco de referencia para decidir qué tan proactivo ser,
cuándo tomar la iniciativa, y a quién/cuándo escalar.
</modo_operativo>`
    : // Sin modo elegido el bloque de arriba se omite entero — pero si el dueño
      // definió un objetivo, ese NO se puede perder: va en su propio bloque.
      objetivo
      ? `<objetivo>
Tu objetivo en cada conversación es: ${objetivo}

No lo anuncies ni lo menciones — es tu criterio interno para decidir hacia
dónde llevar la conversación. Si el cliente no quiere avanzar hacia ahí,
respétalo: nunca insistas de más con tal de cumplirlo.
</objetivo>`
      : "";

  // Sin esto el modelo no tiene forma de saber qué día es "hoy" y adivina —
  // vimos un caso real donde agendó una cita para "mañana" usando 2023 (año
  // de su entrenamiento) en vez del año real, y la cita quedó invisible en
  // /admin/calendario por quedar en el pasado. "Hoy" es en la zona horaria
  // del NEGOCIO (no UTC) — si el tick corre a media noche UTC, para un
  // negocio en México todavía puede ser "ayer".
  const registrar = queRegistrar(input, extraEscalation);

  const now = input.now ?? new Date();
  const timezone = input.timezone || DEFAULT_TIMEZONE;
  const fechaHoy = formatTodayLong(now, timezone);

  return TEMPLATE
    .replaceAll("{{LANGUAGE}}", input.language)
    .replaceAll("{{MODO_OPERATIVO}}", modoOperativo)
    .replaceAll("{{BOT_NAME}}", input.botName)
    .replaceAll("{{BUSINESS_NAME}}", input.businessName)
    .replaceAll("{{BUSINESS_CONTEXT}}", input.businessContext)
    .replaceAll("{{TOOL_LIST}}", toolList)
    .replaceAll("{{TIMEZONE}}", timezone)
    .replaceAll("{{NICHO_PLAYBOOK}}", input.nichoPlaybook ?? "")
    .replaceAll("{{LECCIONES}}", lessonsBlock)
    .replaceAll("{{CONTEXTO_REGIONAL}}", contextoRegional)
    .replaceAll("{{TONE_LINE}}", toneLine)
    .replaceAll("{{QUE_REGISTRAR}}", registrar.bloque)
    .replaceAll("{{PRINCIPIO_ESCALAR}}", registrar.principio)
    .replaceAll("{{FECHA_HOY}}", fechaHoy);
}

export interface SystemPromptOverrides {
  tone?: string;
  extraEscalationKeywords?: string[];
  botName?: string;
  lessons?: string[];
  timezone?: string;
  country?: string;
  currency?: string;
  operatingMode?: { rol: string; estilo: string; objetivo: string; iniciativa: string; escalamiento: string };
  /** El objetivo CONCRETO de este bot (settings.bot_objective). Reemplaza al
   *  objetivo genérico del modo operativo — ver renderSystemPrompt. */
  objective?: string;
}

/** F3 de docs/multitenancy.md: identidad ya no es env, es la fila del bot. */
export interface BotIdentity {
  name: string;
  businessName: string;
  language: string;
}

export function systemPromptFromEnv(
  identity: BotIdentity,
  toolNames: string[],
  businessContext: string,
  nichoPlaybook?: string,
  overrides?: SystemPromptOverrides,
): string {
  return renderSystemPrompt({
    botName: overrides?.botName ?? identity.name,
    businessName: identity.businessName,
    language: identity.language,
    businessContext,
    toolList: toolNames,
    nichoPlaybook,
    tone: overrides?.tone,
    extraEscalationKeywords: overrides?.extraEscalationKeywords,
    lessons: overrides?.lessons,
    timezone: overrides?.timezone,
    country: overrides?.country,
    currency: overrides?.currency,
    operatingMode: overrides?.operatingMode,
    objective: overrides?.objective,
  });
}
