// Casos de relevancia con el buscador REAL: cada pregunta de cliente se busca
// en la base de conocimiento del bot como lo hace searchKb (embedding + top 5
// en pgvector), y cada pasaje devuelto es un caso "¿esto le sirve?".
//
// Solo lectura (un SELECT). Los pasajes son documentos del negocio, no datos
// de clientes. Se agrega a datos/casos.json; correrlo dos veces no duplica.
//
// Uso: npx tsx --env-file=.env scripts/evaluar-jev/relevancia.ts
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPostgresDriver } from "../../src/db/drivers/postgresJs";
import { Db } from "../../src/db/client";
import { PgVectorStore } from "../../src/vector/pgvector";
import { getEmbeddingProvider } from "../../src/ai/embeddings";
import type { Env } from "../../src/env";
import type { Caso } from "./preguntas";

const ARCHIVO = join(process.cwd(), "scripts", "evaluar-jev", "datos", "casos.json");
const BOT = "Asesor de Ventas Kontrolia";

// Preguntas que un cliente de ese bot haría de verdad: las primeras de las
// pruebas y otras escritas a mano, incluidas algunas que la base NO cubre
// (ahí todo lo que traiga el vector es ruido, y es justo lo que se mide).
const PREGUNTAS_EXTRA = [
  "¿Vinqulia se conecta con WhatsApp?",
  "¿Cuánto tarda la implementación?",
  "¿Tienen app para celular?",
  "¿Puedo importar mis clientes desde Excel?",
  "¿Qué pasa con mis datos si cancelo?",
  "¿Dan capacitación al equipo?",
  "¿Kontrolia sirve para facturar?",
  "¿Cuántos usuarios incluye el plan más barato?",
  "¿Hacen descuentos a escuelas?",
  "¿Tienen oficinas en Monterrey?",
  "¿Aceptan pagos con PayPal?",
  "¿Venden computadoras?",
  "¿El sistema funciona sin internet?",
  "¿Cuál es el horario de soporte?",
  "¿Se puede personalizar el embudo de ventas?",
];

const casos = JSON.parse(readFileSync(ARCHIVO, "utf8")) as Caso[];
const sinRelevancia = casos.filter((c) => c.tarea !== "relevancia");

// El PRIMER mensaje de cada escenario de prueba: es la pregunta con la que
// llega el cliente. Los siguientes ya traen correos, nombres o "¿y ahora qué
// sigue?", que no son preguntas para la base.
const RAIZ = join(process.cwd(), "pruebas-resultados");
const deLasPruebas = [
  ...new Set(
    readdirSync(RAIZ)
      .filter((f) => f.endsWith(".json") && !f.includes("rejuzgado"))
      .flatMap((f) => (JSON.parse(readFileSync(join(RAIZ, f), "utf8")).resultados ?? []) as Array<{ transcripcion?: Array<{ rol: string; texto: string }> }>)
      .map((r) => r.transcripcion?.find((t) => t.rol === "cliente")?.texto?.trim())
      .filter((t): t is string => !!t),
  ),
];
const preguntas = [...deLasPruebas, ...PREGUNTAS_EXTRA];

const db = new Db(createPostgresDriver({ url: process.env.DATABASE_URL! }));
const bot = await db.first<{ id: string }>("SELECT id FROM bots WHERE name = ?", [BOT]);
if (!bot) throw new Error(`No existe el bot "${BOT}"`);
const store = new PgVectorStore(db, bot.id);
const embeddings = getEmbeddingProvider(process.env as unknown as Env);

const nuevos: Caso[] = [];
const vectores = await embeddings.embed(preguntas);
for (let i = 0; i < preguntas.length; i++) {
  const matches = await store.query(vectores[i], 5);
  matches.forEach((m, j) =>
    nuevos.push({
      id: `relevancia-q${i}-${j}`,
      tarea: "relevancia",
      origen: i < deLasPruebas.length ? "prueba" : "manual",
      // Mismo título + contenido que searchKb le entrega al agente.
      estado: { pregunta: preguntas[i], pasaje: `${m.metadata.title ?? ""}\n${m.metadata.content}`.slice(0, 1500) },
      // El score del vector es la "regla actual": searchKb dice que abajo de 0.7 no hay match útil.
      esperado: { score_vector: Number(m.score.toFixed(4)), rango: j },
    }),
  );
}

writeFileSync(ARCHIVO, JSON.stringify([...sinRelevancia, ...nuevos], null, 1));
console.log(`${preguntas.length} preguntas → ${nuevos.length} casos de relevancia`);
process.exit(0);
