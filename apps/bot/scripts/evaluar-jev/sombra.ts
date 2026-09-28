// Qué dijo el revisor rápido en modo sombra, contra lo que hizo la regla de
// siempre. Es el dato para decidir si un bot pasa a "activo" (ver
// agent/revisorRapido.ts). Solo lectura.
//
// Uso: npx tsx --env-file=.env scripts/evaluar-jev/sombra.ts [días=7]
import { createPostgresDriver } from "../../src/db/drivers/postgresJs";
import { Db } from "../../src/db/client";
import { UMBRAL_PARA_ACTUAR } from "../../src/ai/preguntasJev";

const dias = Number(process.argv[2] ?? 7);
const desde = Date.now() - dias * 86_400_000;
const db = new Db(createPostgresDriver({ url: process.env.DATABASE_URL! }));

// jev/regla quedan como cadena JSON dentro del jsonb (ver anotarClasificacion).
const promesas = await db.all<{ bot: string; parrafo: string; regla: boolean; jev: number }>(
  `SELECT b.name AS bot,
          (c.regla #>> '{}')::jsonb->>'parrafo' AS parrafo,
          ((c.regla #>> '{}')::jsonb->>'promete_regex')::boolean AS regla,
          ((c.jev #>> '{}')::jsonb->'promete_futuro'->>'noul')::float8 AS jev
     FROM clasificaciones c JOIN bots b ON b.id = c.bot_id
    WHERE c.uso = 'promesas' AND c.created_at > ?`,
  [desde],
);
const pasajes = await db.all<{ bot: string; pregunta: string; titulo: string; score: number; jev: number }>(
  `SELECT b.name AS bot,
          (c.regla #>> '{}')::jsonb->>'pregunta' AS pregunta,
          (c.regla #>> '{}')::jsonb->>'titulo' AS titulo,
          ((c.regla #>> '{}')::jsonb->>'score_vector')::float8 AS score,
          ((c.jev #>> '{}')::jsonb->'ayuda'->>'noul')::float8 AS jev
     FROM clasificaciones c JOIN bots b ON b.id = c.bot_id
    WHERE c.uso = 'relevancia' AND c.created_at > ?`,
  [desde],
);
const lat = await db.first<{ n: number; p50: number; p95: number }>(
  `SELECT count(*)::int AS n,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) AS p50,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY ms) AS p95
     FROM clasificaciones WHERE created_at > ?`,
  [desde],
);

const corto = (s: string) => s.replace(/\s+/g, " ").slice(0, 140);
console.log(`# Revisor rápido en sombra — últimos ${dias} días\n`);
console.log(`Decisiones: ${lat?.n ?? 0} · latencia p50 ${Math.round(lat?.p50 ?? 0)} ms · p95 ${Math.round(lat?.p95 ?? 0)} ms\n`);

console.log(`## Promesas (${promesas.length} párrafos)`);
const soloJev = promesas.filter((p) => p.jev >= UMBRAL_PARA_ACTUAR && !p.regla);
const soloRegla = promesas.filter((p) => p.regla && p.jev < 0.5);
console.log(`- Ambos dicen promesa: ${promesas.filter((p) => p.regla && p.jev >= 0.5).length}`);
console.log(`- Solo Jev, seguro (≥ ${UMBRAL_PARA_ACTUAR}) — lo que "activo" corregiría: ${soloJev.length}`);
console.log(`- Solo la regla: ${soloRegla.length}`);
if (soloJev.length) {
  console.log(`\nLo que activo habría corregido (revisar que de verdad sean promesas):`);
  soloJev.slice(0, 15).forEach((p) => console.log(`  [${p.jev.toFixed(2)}] ${p.bot}: ${corto(p.parrafo)}`));
}
if (soloRegla.length) {
  console.log(`\nLo que la regla marcó y Jev no:`);
  soloRegla.slice(0, 10).forEach((p) => console.log(`  [${p.jev.toFixed(2)}] ${p.bot}: ${corto(p.parrafo)}`));
}

console.log(`\n## Relevancia de la búsqueda (${pasajes.length} pasajes)`);
const utiles = pasajes.filter((p) => p.jev >= 0.5);
console.log(`- Jev dice que sirven: ${utiles.length} de ${pasajes.length}`);
console.log(`- De esos, pasan el umbral 0.7 del vector: ${utiles.filter((p) => p.score >= 0.7).length}`);
const inutilesSeguro = pasajes.filter((p) => p.jev <= 0.1);
console.log(`- Jev seguro de que NO sirven (≤ 0.1): ${inutilesSeguro.length}`);

// ── Análisis CRM: ¿se podría saltar el LLM? ─────────────────────────────────
const crm = await db.all<{ bot: string; propuestas: number; senales: Record<string, { noul: number }> }>(
  `SELECT b.name AS bot,
          ((c.regla #>> '{}')::jsonb->>'propuestas')::int AS propuestas,
          (c.jev #>> '{}')::jsonb AS senales
     FROM clasificaciones c JOIN bots b ON b.id = c.bot_id
    WHERE c.uso = 'crm' AND c.created_at > ?`,
  [desde],
);
const maxSenal = (s: Record<string, { noul: number }>) => Math.max(...Object.values(s).map((x) => x.noul));
console.log(`\n## Análisis CRM (${crm.length} análisis)`);
const nadaSeguro = crm.filter((c) => maxSenal(c.senales) <= 0.1);
console.log(`- Con propuestas: ${crm.filter((c) => c.propuestas > 0).length}; sin ninguna: ${crm.filter((c) => c.propuestas === 0).length}`);
console.log(`- Jev seguro de que no hay nada (todas las señales ≤ 0.1): ${nadaSeguro.length} — llamadas al LLM que se ahorrarían`);
console.log(`- …de esas, las que SÍ dieron propuestas (se perderían): ${nadaSeguro.filter((c) => c.propuestas > 0).length}`);

// ── Filtro de correo: ¿coinciden? ¿se habría tirado a un cliente? ──────────
const correos = await db.all<{ asunto: string; llm: string; conf: number; atender: boolean; jev: string; jevConf: number }>(
  `SELECT (c.regla #>> '{}')::jsonb->>'asunto' AS asunto,
          (c.regla #>> '{}')::jsonb->>'categoria' AS llm,
          ((c.regla #>> '{}')::jsonb->>'confianza')::float8 AS conf,
          ((c.regla #>> '{}')::jsonb->>'atender')::boolean AS atender,
          (c.jev #>> '{}')::jsonb->'categoria'->>'choice' AS jev,
          ((c.jev #>> '{}')::jsonb->'categoria'->>'confidence')::float8 AS "jevConf"
     FROM clasificaciones c
    WHERE c.uso = 'correo' AND c.created_at > ?`,
  [desde],
);
console.log(`\n## Filtro de correo (${correos.length} correos)`);
console.log(`- Misma categoría: ${correos.filter((c) => c.llm === c.jev).length} de ${correos.length}`);
const distintos = correos.filter((c) => c.llm !== c.jev);
// Lo grave: uno de los dos lo descartaría y el otro dice que es un cliente.
distintos.forEach((c) =>
  console.log(`  ${c.llm === "cliente" || c.jev === "cliente" ? "⚠" : " "} LLM=${c.llm} (${c.conf}) Jev=${c.jev} (${c.jevConf?.toFixed(2)}) · ${c.atender ? "se atendió" : "se filtró"} · ${corto(c.asunto ?? "")}`),
);
// ── Respuestas a seguimientos: qué contestó la gente ───────────────────────
const seguimientos = await db.all<{ bot: string; intencion: string; conf: number; accion: string; modo: string }>(
  `SELECT b.name AS bot,
          (c.jev #>> '{}')::jsonb->'intencion'->>'choice' AS intencion,
          ((c.jev #>> '{}')::jsonb->'intencion'->>'confidence')::float8 AS conf,
          (c.regla #>> '{}')::jsonb->>'accion' AS accion,
          c.modo
     FROM clasificaciones c JOIN bots b ON b.id = c.bot_id
    WHERE c.uso = 'seguimiento' AND c.created_at > ?`,
  [desde],
);
console.log(`\n## Respuestas a seguimientos (${seguimientos.length})`);
for (const i of ["interesado", "no_interesado", "pregunta", "otro"]) {
  const deEsta = seguimientos.filter((s) => s.intencion === i);
  const seguras = deEsta.filter((s) => s.conf >= UMBRAL_PARA_ACTUAR).length;
  console.log(`- ${i}: ${deEsta.length} (seguras ≥ ${UMBRAL_PARA_ACTUAR}: ${seguras})`);
}
const acciones = seguimientos.filter((s) => s.accion && s.accion !== "ninguna");
if (acciones.length) console.log(`- Acciones tomadas en activo: ${acciones.map((s) => `${s.accion} (${s.bot})`).join(", ")}`);
process.exit(0);
