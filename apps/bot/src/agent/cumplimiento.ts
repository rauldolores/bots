// "Dijo que lo hizo, pero no lo hizo" y "prometió algo que nada va a hacer" —
// la guarda de cumplimiento del agente.
//
// Las pruebas automáticas del 2026-09-24 lo encontraron en todos los canales:
//   - "ya registré tu caso", sin haber llamado a ninguna herramienta;
//   - "recibirás un correo con los detalles de la cita", "te mando el enlace
//     al terminar la conversación": nada en el sistema hace eso.
// El prompt lo prohíbe (<anti_patterns>) y el modelo lo hace igual. Una regla
// que el modelo puede ignorar no es una garantía; esto sí: antes de que la
// respuesta salga, se compara lo que dice contra lo que las herramientas de
// ESTE turno de verdad hicieron, y si no cuadra se le pide corregir.
//
// Todo se detecta por ESTRUCTURA (tiempo verbal + tipo de acción), no por
// frases de un giro: sirve igual para una clínica que para un taller. La
// parte de "ya lo hice" es el mismo detector que revisaba las llamadas de voz
// después de colgar (channels/voice/verificarPromesas.ts).
import { conciliar, type PromesaIncumplida } from "../channels/voice/verificarPromesas";

export interface HerramientaDelTurno {
  toolName: string;
  ok?: boolean;
  /** Lo que devolvió, resumido — se le muestra al modelo al pedirle corregir. */
  output?: string;
}

export type Hallazgo =
  | { tipo: "afirmacion"; promesa: PromesaIncumplida }
  | { tipo: "promesa_futura"; frase: string };

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Promesas de algo que pasaría DESPUÉS, por sí solo, y que el agente no puede
 * hacer: mandar algo más tarde, llamar, avisar, recordar.
 *
 * Lo que NO entra, a propósito: "alguien del equipo te contactará" (tercera
 * persona: lo respalda el lead o el ticket, que le avisa al dueño) y las
 * intenciones inmediatas ("te lo registro ahora") — esas las cubre la otra
 * mitad de la guarda si luego dice que ya quedó.
 */
const PROMESAS_A_FUTURO: RegExp[] = [
  // "recibirás un correo con los detalles", "te llegará la confirmación"
  /\b(recibiras|recibira usted|te llegara|te llegaran|te va a llegar|te van a llegar|le llegara)\b[^.!?\n]{0,60}\b(correo|email|e-mail|mail|mensaje|enlace|link|liga|propuesta|cotizacion|confirmacion|invitacion|documento|archivo|detalles)\b/,
  // "te enviaré", "te mandaremos", "te haré llegar"
  /\bte (enviare|mandare|enviaremos|mandaremos|hare llegar|haremos llegar|compartire|compartiremos)\b/,
  /\ble (enviare|mandare|enviaremos|mandaremos|hare llegar|haremos llegar)\b/,
  // el propio agente llamando o escribiendo después: no tiene cómo
  /\bte (llamare|marcare|escribire|avisare|recordare|contactare)\b/,
  // "al terminar la conversación te…"
  /\bal (terminar|finalizar|concluir|cerrar) (la|nuestra|esta) (conversacion|llamada|charla|platica)\b/,
];

export function promesaAFuturo(texto: string): string | null {
  const t = normalizar(texto);
  for (const re of PROMESAS_A_FUTURO) {
    const m = t.match(re);
    if (m) return m[0];
  }
  return null;
}

/**
 * La promesa incumplida de esta respuesta, o null si todo lo que afirma está
 * respaldado. Un resultado sin marcar (`ok` undefined) cuenta como hecho:
 * mejor dejar pasar una duda que corregir de más.
 */
export function afirmacionSinRespaldo(texto: string, herramientas: HerramientaDelTurno[]): PromesaIncumplida | null {
  if (!texto.trim()) return null;
  // Se revisa por párrafo: conciliar decide qué herramienta respalda cada
  // afirmación según de qué habla, y un párrafo es una afirmación.
  const parrafos = texto.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const hechas = herramientas.map((h) => ({ tool: h.toolName, ok: h.ok !== false }));
  return conciliar(parrafos, hechas)[0] ?? null;
}

/** Lo primero que no cuadra en esta respuesta, o null. */
export function revisarCumplimiento(texto: string, herramientas: HerramientaDelTurno[]): Hallazgo | null {
  const promesa = afirmacionSinRespaldo(texto, herramientas);
  if (promesa) return { tipo: "afirmacion", promesa };
  const frase = promesaAFuturo(texto);
  if (frase) return { tipo: "promesa_futura", frase };
  return null;
}

function resumenDeHerramientas(herramientas: HerramientaDelTurno[]): string {
  if (herramientas.length === 0) return "En este turno no se ejecutó ninguna herramienta.";
  return (
    "Herramientas de este turno y lo que devolvieron:\n" +
    herramientas
      .map((h) => `- ${h.toolName}${h.ok === false ? " (FALLÓ)" : ""}: ${(h.output ?? "").slice(0, 400)}`)
      .join("\n")
  );
}

/**
 * Lo que se le dice al modelo para que corrija. Va como un mensaje más de la
 * conversación: nunca llega al cliente ni se guarda en el historial.
 */
export function notaDeCorreccion(h: Hallazgo, herramientas: HerramientaDelTurno[] = []): string {
  const encabezado = "[AVISO INTERNO DEL SISTEMA — no es del cliente, no lo menciones]\n";
  const cierre = `\n${resumenDeHerramientas(herramientas)}\nEscribe el mensaje final para el cliente, completo, en el mismo tono.`;
  if (h.tipo === "afirmacion") {
    const p = h.promesa;
    const que =
      p.motivo === "herramienta_fallo"
        ? `la herramienta ${p.herramienta ?? ""} falló${p.detalle ? ` (${p.detalle})` : ""}`
        : "en este turno no se ejecutó ninguna herramienta que lo haga";
    return (
      encabezado +
      `Tu respuesta dice "${p.dijo}", pero ${que}. No se le puede decir al cliente que algo ya quedó hecho si no ocurrió.\n` +
      `- Si ya tienes los datos necesarios, llama AHORA la herramienta que corresponde y responde según su resultado.\n` +
      `- Si te falta algún dato (nombre, contacto, fecha), pídeselo en lugar de afirmar que ya está hecho.\n` +
      `- Si en realidad ya lo hiciste en un turno ANTERIOR de esta conversación, puedes decirlo tal cual.` +
      cierre
    );
  }
  return (
    encabezado +
    `Tu respuesta promete algo que pasaría después por sí solo ("${h.frase}"). Nada en el sistema lo hace: no mandas correos ni enlaces más tarde, no llamas, no avisas ni recuerdas por tu cuenta.\n` +
    `- Si una herramienta de este turno dice explícitamente que eso va a ocurrir (por ejemplo, que el calendario envía una confirmación), puedes decirlo tal cual.\n` +
    `- Si lo que quieres es entregar algo, entrégalo AHORA con la herramienta que corresponda.\n` +
    `- Si no, quita esa promesa. Si registraste el caso o el interés, di que alguien del equipo le dará seguimiento, sin prometer qué le enviarán ni cuándo.` +
    cierre
  );
}

/**
 * La versión para una LLAMADA. En voz no se puede frenar la respuesta antes de
 * que salga (ya se está diciendo en voz alta), así que el aviso llega como
 * contexto para la SIGUIENTE intervención del agente: que lo corrija con
 * naturalidad en vez de dejar al cliente con una promesa falsa.
 */
export function notaDeCorreccionEnVivo(h: Hallazgo): string {
  const que =
    h.tipo === "afirmacion"
      ? `Acabas de decir "${h.promesa.dijo}", pero ${
          h.promesa.motivo === "herramienta_fallo"
            ? `la herramienta ${h.promesa.herramienta ?? ""} falló`
            : "no se ejecutó ninguna herramienta que lo haga"
        }: eso NO ha ocurrido.`
      : `Acabas de prometer "${h.frase}", y nada en el sistema hace eso por sí solo.`;
  return (
    `[AVISO INTERNO DEL SISTEMA — no lo menciones ni lo leas en voz alta] ${que} ` +
    `En tu siguiente intervención corrígelo con naturalidad: si ya tienes los datos, usa AHORA la herramienta que corresponde; ` +
    `si te falta alguno (nombre, contacto), pídelo; y no vuelvas a afirmar ni prometer lo que no está hecho.`
  );
}
