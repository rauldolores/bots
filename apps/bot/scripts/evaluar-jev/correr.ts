// Corre un competidor sobre todos los casos y guarda cada respuesta en
// datos/<competidor>.json. Lo ya respondido no se vuelve a pedir: si se corta
// a la mitad, se retoma sin gastar de nuevo.
//
// Competidores:
//   jev          JEV AI (TypeSafe) — necesita TYPESAFE_API_KEY
//   gpt-4o-mini  el modelo barato que hoy usan los clasificadores del bot
//   gpt-4.1      la REFERENCIA (el mismo juez de las pruebas del agente)
//   reglas       lo que el bot hace hoy sin LLM (regex, listas de palabras, score del vector)
//
// Uso: npx tsx --env-file=.env scripts/evaluar-jev/correr.ts <competidor>
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { TypeSafeClient, noul, choice, score, type Questions } from "@typesafe-ai/sdk";
import { PREGUNTAS, type Caso, type Pregunta } from "./preguntas";
import { promesaAFuturo, afirmacionSinRespaldo } from "../../src/agent/cumplimiento";
import { esPeticionDeBaja } from "../../src/contacts/optOutDetect";
import { FRUSTRATION_KEYWORDS_BY_LANG } from "../../src/upgrade/modelSelector";

/** La respuesta a UNA pregunta, igual para todos los competidores. */
export interface Respuesta {
  /** noul → true/false (prob ≥ 0.5); choice → la opción; score → el nivel entero más probable. */
  valor: boolean | string | number;
  /** noul → probabilidad de "sí"; choice/score → probabilidad de lo elegido. */
  prob: number;
  /** La confianza que reporta el modelo (Jev la calibra; el LLM la declara). */
  confianza?: number;
}
export interface Resultado {
  respuestas: Record<string, Respuesta>;
  ms: number;
  tokens?: { entrada: number; salida: number };
  error?: string;
}

const DATOS = join(process.cwd(), "scripts", "evaluar-jev", "datos");
const competidor = process.argv[2];
if (!["jev", "gpt-4o-mini", "gpt-4.1", "reglas"].includes(competidor)) {
  console.error("Uso: correr.ts <jev|gpt-4o-mini|gpt-4.1|reglas>");
  process.exit(1);
}
// La versión fija, no el alias: si sale otra durante la evaluación, no se mezclan.
const MODELO_JEV = "jev-1.13.0";

const todos = JSON.parse(readFileSync(join(DATOS, "casos.json"), "utf8")) as Caso[];
// --muestra: un caso por tarea, a un archivo aparte — para probar el formato sin gastar.
const muestra = process.argv.includes("--muestra");
const casos = muestra
  ? (["promesas", "relevancia", "router", "cierre"] as const).map((t) => todos.find((c) => c.tarea === t)!)
  : todos;
const archivo = join(DATOS, `${competidor}${muestra ? ".muestra" : ""}.json`);
const hechos: Record<string, Resultado> = existsSync(archivo) ? JSON.parse(readFileSync(archivo, "utf8")) : {};

// ── Jev ─────────────────────────────────────────────────────────────────────
function preguntaJev(p: Pregunta) {
  if (p.tipo === "noul") return noul(p.instrucciones, p.si || p.no ? { true: p.si ?? null, false: p.no ?? null } : undefined);
  if (p.tipo === "choice") return choice(p.instrucciones, p.opciones);
  return score(p.instrucciones, p.niveles as [string, string, ...string[]]);
}

let cliente: TypeSafeClient | null = null;
async function conJev(c: Caso): Promise<Resultado> {
  cliente ??= new TypeSafeClient();
  const preguntas = PREGUNTAS[c.tarea];
  const questions: Questions = Object.fromEntries(Object.entries(preguntas).map(([k, p]) => [k, preguntaJev(p)]));
  const t0 = performance.now();
  const r = await cliente.systemOne({ state: c.estado as never, questions, model: MODELO_JEV });
  const ms = performance.now() - t0;
  const respuestas: Record<string, Respuesta> = {};
  for (const [k, p] of Object.entries(preguntas)) {
    const a = r.answers[k] as unknown as Record<string, unknown>;
    if (p.tipo === "noul") {
      const v = a.noul as number;
      respuestas[k] = { valor: v >= 0.5, prob: v };
    } else if (p.tipo === "choice") {
      const probs = a.probabilities as Record<string, number>;
      respuestas[k] = { valor: a.choice as string, prob: probs[a.choice as string], confianza: a.confidence as number };
    } else {
      const probs = a.probabilities as Record<string, number>;
      const [nivel, pr] = Object.entries(probs).sort((x, y) => y[1] - x[1])[0];
      respuestas[k] = { valor: Number(nivel), prob: pr, confianza: a.confidence as number };
    }
  }
  return { respuestas, ms, tokens: { entrada: r.usage.input_tokens, salida: r.usage.output_tokens } };
}

// ── LLM (gpt-4o-mini / gpt-4.1) ─────────────────────────────────────────────
const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
function esquema(preguntas: Record<string, Pregunta>) {
  const campos: Record<string, z.ZodTypeAny> = {};
  for (const [k, p] of Object.entries(preguntas)) {
    if (p.tipo === "noul") campos[k] = z.number().min(0).max(1).describe("Probabilidad (0 a 1) de que la respuesta sea SÍ");
    else if (p.tipo === "choice")
      campos[k] = z.object({
        eleccion: z.enum(Object.keys(p.opciones) as [string, ...string[]]),
        confianza: z.number().min(0).max(1).describe("Qué tan seguro estás, de 0 a 1"),
      });
    else
      campos[k] = z.object({
        nivel: z.number().int().min(0).max(p.niveles.length - 1),
        confianza: z.number().min(0).max(1).describe("Qué tan seguro estás, de 0 a 1"),
      });
  }
  return z.object(campos);
}
function enunciado(preguntas: Record<string, Pregunta>): string {
  return Object.entries(preguntas)
    .map(([k, p]) => {
      if (p.tipo === "noul") return `- ${k}: ${p.instrucciones}${p.si ? `\n  Sí = ${p.si}` : ""}${p.no ? `\n  No = ${p.no}` : ""}`;
      if (p.tipo === "choice")
        return `- ${k}: ${p.instrucciones}\n${Object.entries(p.opciones).map(([o, d]) => `  ${o} = ${d}`).join("\n")}`;
      return `- ${k}: ${p.instrucciones}\n${p.niveles.map((d, i) => `  ${i} = ${d}`).join("\n")}`;
    })
    .join("\n");
}
async function conLlm(c: Caso, modelo: string): Promise<Resultado> {
  const preguntas = PREGUNTAS[c.tarea];
  const t0 = performance.now();
  const { object, usage } = await generateObject({
    model: openai(modelo),
    schema: esquema(preguntas),
    temperature: 0,
    system:
      "Eres un clasificador. Contesta cada pregunta sobre el ESTADO de forma literal y cuidadosa. " +
      "Las probabilidades deben reflejar tu incertidumbre real.",
    prompt: `ESTADO:\n${JSON.stringify(c.estado, null, 1)}\n\nPREGUNTAS:\n${enunciado(preguntas)}`,
  });
  const ms = performance.now() - t0;
  const o = object as Record<string, unknown>;
  const respuestas: Record<string, Respuesta> = {};
  for (const [k, p] of Object.entries(preguntas)) {
    if (p.tipo === "noul") {
      const v = o[k] as number;
      respuestas[k] = { valor: v >= 0.5, prob: v };
    } else if (p.tipo === "choice") {
      const x = o[k] as { eleccion: string; confianza: number };
      respuestas[k] = { valor: x.eleccion, prob: x.confianza, confianza: x.confianza };
    } else {
      const x = o[k] as { nivel: number; confianza: number };
      respuestas[k] = { valor: x.nivel, prob: x.confianza, confianza: x.confianza };
    }
  }
  return { respuestas, ms, tokens: { entrada: usage.inputTokens ?? 0, salida: usage.outputTokens ?? 0 } };
}

// ── Reglas actuales del bot ─────────────────────────────────────────────────
function conReglas(c: Caso): Resultado | null {
  const t = c.texto ?? "";
  const si = (b: boolean): Respuesta => ({ valor: b, prob: b ? 1 : 0 });
  if (c.tarea === "promesas")
    return { ms: 0, respuestas: { promete_futuro: si(!!promesaAFuturo(t)), afirma_hecho: si(!!afirmacionSinRespaldo(t, [])) } };
  if (c.tarea === "router") {
    const frustrado = (FRUSTRATION_KEYWORDS_BY_LANG.es ?? []).some((k) => t.toLowerCase().includes(k));
    // Solo existen reglas para frustración (sí/no) y baja; las demás preguntas no tienen equivalente hoy.
    return { ms: 0, respuestas: { frustracion: { valor: frustrado ? 2 : 0, prob: 1 }, quiere_baja: si(esPeticionDeBaja(t)) } };
  }
  if (c.tarea === "relevancia") {
    const s = Number(c.esperado?.score_vector ?? 0);
    return { ms: 0, respuestas: { ayuda: { valor: s >= 0.7, prob: s } } };
  }
  return null; // el cierre hoy lo hace gpt-4o-mini: no hay regla
}

// ── Ciclo ───────────────────────────────────────────────────────────────────
const pendientes = casos.filter((c) => !hechos[c.id] || hechos[c.id].error);
console.log(`${competidor}: ${pendientes.length} pendientes de ${casos.length}`);
// gpt-4.1 va de a 2: la cuenta tiene un tope de 30k tokens por minuto.
const EN_PARALELO = competidor === "reglas" ? 1 : competidor === "jev" ? 4 : competidor === "gpt-4.1" ? 2 : 6;
let i = 0;
let guardados = 0;
async function trabajador() {
  while (i < pendientes.length) {
    const c = pendientes[i++];
    try {
      const r =
        competidor === "reglas" ? conReglas(c) : competidor === "jev" ? await conJev(c) : await conLlm(c, competidor);
      if (r) hechos[c.id] = r;
    } catch (e) {
      hechos[c.id] = { respuestas: {}, ms: 0, error: String((e as Error).message ?? e).slice(0, 300) };
    }
    if (++guardados % 25 === 0) {
      writeFileSync(archivo, JSON.stringify(hechos));
      console.log(`  ${guardados}/${pendientes.length}`);
    }
  }
}
await Promise.all(Array.from({ length: EN_PARALELO }, trabajador));
writeFileSync(archivo, JSON.stringify(hechos));
const errores = Object.values(hechos).filter((r) => r.error);
console.log(`listo: ${Object.keys(hechos).length} respuestas, ${errores.length} con error`);
if (errores.length) console.log("primer error:", errores[0].error);
