// El informe de la fase 0: qué tanto coincide cada competidor con la
// referencia (gpt-4.1) y con lo esperado en los casos escritos a mano, cuánto
// tarda y cuánto cuesta.
//
// Métricas que importan para decidir:
//   - acuerdo: % de casos donde dice lo mismo que la referencia;
//   - para las preguntas de sí/no con pocos "sí" (bajas, pedir humano), la
//     exhaustividad y la precisión del "sí": el 95% de acuerdo no dice nada si
//     todo es "no";
//   - "seguro": los casos donde el modelo está muy seguro (prob ≤ 0.1 o ≥ 0.9,
//     o confianza ≥ 0.9), qué parte del total son y qué tanto acierta ahí. Es
//     lo que permitiría que actúe solo.
//
// Uso: npx tsx scripts/evaluar-jev/informe.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PREGUNTAS, type Caso, type Tarea } from "./preguntas";
import type { Resultado } from "./correr";

const DATOS = join(process.cwd(), "scripts", "evaluar-jev", "datos");
const casos = JSON.parse(readFileSync(join(DATOS, "casos.json"), "utf8")) as Caso[];
const cargar = (n: string): Record<string, Resultado> | null =>
  existsSync(join(DATOS, `${n}.json`)) ? JSON.parse(readFileSync(join(DATOS, `${n}.json`), "utf8")) : null;

const REFERENCIA = cargar("gpt-4.1");
const COMPETIDORES = ["jev", "gpt-4o-mini", "reglas"].filter((n) => cargar(n));
if (!REFERENCIA) throw new Error("Falta la referencia: corre correr.ts gpt-4.1");

// $ por millón de tokens (entrada, salida).
const PRECIO: Record<string, [number, number]> = { jev: [0.042, 0], "gpt-4o-mini": [0.15, 0.6], "gpt-4.1": [2, 8] };

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "—");
const lineas: string[] = [];
const out = (s = "") => lineas.push(s);

/** El valor como algo comparable: la frustración se compara en dos cubetas (≥2 = frustrado o enojado). */
function comparable(tarea: Tarea, pregunta: string, v: unknown): string {
  if (tarea === "router" && pregunta === "frustracion") return Number(v) >= 2 ? "frustrado" : "tranquilo";
  return String(v);
}
function seguro(r: { prob: number; confianza?: number }, tipo: string): boolean {
  if (tipo === "noul") return r.prob <= 0.1 || r.prob >= 0.9;
  return (r.confianza ?? r.prob) >= 0.9;
}

out("# Fase 0 — JEV AI en español");
out();
out(`Casos: ${casos.length}. Referencia: gpt-4.1. "seguro" = prob ≤ 0.1 o ≥ 0.9 (sí/no), o confianza ≥ 0.9 (opciones).`);

for (const tarea of Object.keys(PREGUNTAS) as Tarea[]) {
  const deTarea = casos.filter((c) => c.tarea === tarea);
  out();
  out(`## ${tarea} (${deTarea.length} casos)`);
  for (const [pid, p] of Object.entries(PREGUNTAS[tarea])) {
    out();
    out(`### ${pid}`);
    out("| competidor | acuerdo | «sí» de la ref. encontrados | «sí» correctos | seguro: cobertura | seguro: acuerdo | vs. esperado (manual) |");
    out("|---|---|---|---|---|---|---|");
    for (const nombre of [...COMPETIDORES, "gpt-4.1"]) {
      const res = nombre === "gpt-4.1" ? REFERENCIA : cargar(nombre)!;
      let n = 0, ok = 0, refSi = 0, refSiHallado = 0, dijoSi = 0, dijoSiBien = 0, seg = 0, segOk = 0, man = 0, manOk = 0;
      for (const c of deTarea) {
        const r = res[c.id]?.respuestas?.[pid];
        const ref = REFERENCIA[c.id]?.respuestas?.[pid];
        if (!r) continue;
        if (ref && nombre !== "gpt-4.1") {
          n++;
          const igual = comparable(tarea, pid, r.valor) === comparable(tarea, pid, ref.valor);
          if (igual) ok++;
          if (p.tipo === "noul") {
            if (ref.valor === true) { refSi++; if (r.valor === true) refSiHallado++; }
            if (r.valor === true) { dijoSi++; if (ref.valor === true) dijoSiBien++; }
          }
          if (seguro(r, p.tipo)) { seg++; if (igual) segOk++; }
        }
        const esp = c.esperado?.[pid];
        // Lo esperado se escribió solo para algunos casos manuales, y solo por pregunta.
        if (c.origen === "manual" && esp !== undefined) {
          man++;
          if (comparable(tarea, pid, r.valor) === comparable(tarea, pid, esp)) manOk++;
        }
      }
      const sinRef = nombre === "gpt-4.1";
      out(
        `| ${nombre} | ${sinRef ? "(ref.)" : pct(ok, n)} | ${sinRef || p.tipo !== "noul" ? "—" : `${refSiHallado}/${refSi}`} | ${sinRef || p.tipo !== "noul" ? "—" : `${dijoSiBien}/${dijoSi}`} | ${sinRef ? "—" : pct(seg, n)} | ${sinRef ? "—" : pct(segOk, seg)} | ${man ? `${manOk}/${man}` : "—"} |`,
      );
    }
  }
}

// ── Latencia y costo ────────────────────────────────────────────────────────
out();
out("## Latencia y costo por llamada");
out("| competidor | llamadas | p50 | p95 | $ por 1,000 llamadas |");
out("|---|---|---|---|---|");
for (const nombre of [...COMPETIDORES.filter((n) => n !== "reglas"), "gpt-4.1"]) {
  const res = Object.values(nombre === "gpt-4.1" ? REFERENCIA : cargar(nombre)!).filter((r) => !r.error && r.ms > 0);
  const ms = res.map((r) => r.ms).sort((a, b) => a - b);
  const q = (x: number) => `${Math.round(ms[Math.min(ms.length - 1, Math.floor(x * ms.length))])} ms`;
  const [pe, ps] = PRECIO[nombre];
  const costo = res.reduce((s, r) => s + ((r.tokens?.entrada ?? 0) * pe + (r.tokens?.salida ?? 0) * ps) / 1e6, 0);
  out(`| ${nombre} | ${res.length} | ${q(0.5)} | ${q(0.95)} | $${((1000 * costo) / Math.max(1, res.length)).toFixed(3)} |`);
}

const errores = COMPETIDORES.flatMap((n) => Object.entries(cargar(n)!).filter(([, r]) => r.error).map(([id, r]) => `${n} ${id}: ${r.error}`));
if (errores.length) {
  out();
  out(`## Errores (${errores.length})`);
  errores.slice(0, 10).forEach((e) => out(`- ${e}`));
}

writeFileSync(join(DATOS, "informe.md"), lineas.join("\n"));
console.log(lineas.join("\n"));
