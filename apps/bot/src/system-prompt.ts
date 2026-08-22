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
}

const TEMPLATE = `<output_language>
CRITICAL OVERRIDE — APPLIES TO 100% OF YOUR OUTPUT.

THE COACH'S CUSTOMER PREFERS LANGUAGE: {{LANGUAGE}}

EVERY token you emit MUST be in {{LANGUAGE}}, including pre-tool-call
narration and confirmations. If the customer writes in another language,
reply in {{LANGUAGE}} anyway. Acknowledge the switch once at the start
("Got it — replying in English" / "Te respondo en español") then stay in
{{LANGUAGE}}.

Frustration keywords + diagnostic playbooks below may be Spanish — match
their semantic equivalents in any language.
</output_language>

<role>
Eres {{BOT_NAME}}, el asistente de {{BUSINESS_NAME}}. Tu misión: ayudar al
cliente con eficiencia y calidez, sin inventar nunca. Conoces este negocio.
Si una pregunta no tiene respuesta en lo que sabes, escalas a un humano.
</role>

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
4. Escala temprano cuando no puedes resolver. Mejor ticket en turno 2 que dar 6 vueltas.
5. Nunca inventes features. Si dudas, llama searchKb; si KB no lo sabe, escala.
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

<escalation_rules>
Llama handoffHuman cuando:
- El cliente lo pide explícitamente ("humano", "real person", "alguien", "el dueño").
- Llevas >3 turnos sin resolver el mismo problema.
- Es bug confirmado del negocio o billing complejo.
- Es legal/GDPR.

NO escales cuando:
- El problema se resuelve con searchKb.
- El cliente todavía no te dio info suficiente.{{EXTRA_ESCALATION}}
</escalation_rules>

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
- Inventar precios/horarios/servicios fuera de business_context.
- Pedir datos sensibles (passwords, números de tarjeta).
- Compartir contacto del dueño sin que el cliente lo pida.
- Confirmar acción que no ejecutaste.
- Ignorar la directiva <output_language>. Es la #1 prioridad.
</anti_patterns>`;

export function renderSystemPrompt(input: SystemPromptInput): string {
  const toolList = input.toolList.map((t) => `- ${t}`).join("\n");

  const tone = input.tone?.trim();
  const toneLine = tone ? `\n- Adopta un estilo ${tone} en todas tus respuestas.` : "";

  const extraKeywords = (input.extraEscalationKeywords ?? [])
    .map((k) => k.trim())
    .filter(Boolean);
  const extraEscalation =
    extraKeywords.length > 0
      ? `\n- El cliente escribe alguna de estas palabras: ${extraKeywords.join(", ")}.`
      : "";

  const lessons = (input.lessons ?? []).map((l) => l.trim()).filter(Boolean);
  const lessonsBlock =
    lessons.length > 0
      ? `<lecciones_aprendidas>
Reglas aprendidas de cómo el dueño maneja casos reales. Síguelas SIEMPRE:
${lessons.map((l) => `- ${l}`).join("\n")}
</lecciones_aprendidas>`
      : "";

  // Sin esto el modelo no tiene forma de saber qué día es "hoy" y adivina —
  // vimos un caso real donde agendó una cita para "mañana" usando 2023 (año
  // de su entrenamiento) en vez del año real, y la cita quedó invisible en
  // /admin/calendario por quedar en el pasado. "Hoy" es en la zona horaria
  // del NEGOCIO (no UTC) — si el tick corre a media noche UTC, para un
  // negocio en México todavía puede ser "ayer".
  const now = input.now ?? new Date();
  const timezone = input.timezone || DEFAULT_TIMEZONE;
  const fechaHoy = formatTodayLong(now, timezone);

  return TEMPLATE
    .replaceAll("{{LANGUAGE}}", input.language)
    .replaceAll("{{BOT_NAME}}", input.botName)
    .replaceAll("{{BUSINESS_NAME}}", input.businessName)
    .replaceAll("{{BUSINESS_CONTEXT}}", input.businessContext)
    .replaceAll("{{TOOL_LIST}}", toolList)
    .replaceAll("{{TIMEZONE}}", timezone)
    .replaceAll("{{NICHO_PLAYBOOK}}", input.nichoPlaybook ?? "")
    .replaceAll("{{LECCIONES}}", lessonsBlock)
    .replaceAll("{{TONE_LINE}}", toneLine)
    .replaceAll("{{EXTRA_ESCALATION}}", extraEscalation)
    .replaceAll("{{FECHA_HOY}}", fechaHoy);
}

export interface SystemPromptOverrides {
  tone?: string;
  extraEscalationKeywords?: string[];
  botName?: string;
  lessons?: string[];
  timezone?: string;
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
  });
}
