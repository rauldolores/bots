// Adaptador de servidor Node de larga vida: local, Docker, Railway, Render, Fly
// o un VPS. Es el destino más simple, porque el proceso no muere entre
// peticiones y puede llevar sus propios temporizadores.
//
// Arranque:  DATABASE_URL=postgresql://… node --import tsx src/runtime/node.ts
// (o `npm run start:node`)

import { serve } from "@hono/node-server";
import app, { runScheduledJobs, DAILY_CRON, ESTADO_CRON } from "../app";
import { prepareEnv, closeDrivers } from "./env";
import { tick } from "../queue/tick";
import { attachVoiceGateway } from "../channels/voice/gateway";
import type { Env } from "../env";

const PORT = Number(process.env.PORT ?? 8787);

// Para despliegues divididos (Voice en Fly.io, el resto en Vercel/Cloudflare):
// este proceso YA solo recibe tráfico de voz, así que correr la cola y los
// crons aquí sería puro trabajo duplicado (y en el caso del flywheel/insights,
// gasto de IA duplicado) sobre lo que ya hace la otra instancia. Sin la
// variable, el comportamiento es el de siempre: todo en un solo proceso.
const VOICE_ONLY = process.env.VOICE_ONLY === "1";

/**
 * Cada cuánto mira la cola. A 2s el bot responde prácticamente en el instante
 * en que vence el buffer, y el costo es una consulta indexada que casi siempre
 * devuelve cero filas.
 */
const TICK_MS = Number(process.env.TICK_INTERVAL_MS ?? 2000);

const env: Env = prepareEnv(process.env as Record<string, unknown>);

const server = serve({ fetch: (req: Request) => app.fetch(req, env), port: PORT }, (info) => {
  console.log(`Nodia Agents escuchando en http://localhost:${info.port}`);
  if (VOICE_ONLY) {
    console.log("VOICE_ONLY=1 — sin cola ni crons propios, solo el Voice Gateway.");
  } else {
    console.log(`Panel: http://localhost:${info.port}/admin`);
  }
});

// Voice Gateway (F7 fase 2): el WebSocket de Media Streams solo existe acá —
// es el único de los 3 destinos con un proceso de larga vida para sostenerlo.
attachVoiceGateway(server, env);

// El latido de la cola. `enCurso` evita que un turno lento se solape consigo
// mismo: sin eso, un tick de 2s sobre un LLM de 10s acumularía trabajo.
let enCurso = false;
const latido = VOICE_ONLY
  ? null
  : setInterval(async () => {
      if (enCurso) return;
      enCurso = true;
      try {
        await tick(env);
      } catch (e) {
        console.error("[tick]", e);
      } finally {
        enCurso = false;
      }
    }, TICK_MS);

// Los trabajos periódicos. En un servidor propio no hay cron de plataforma, así
// que se llevan por dentro: los nocturnos, en la vuelta de cada hora que cae a
// las 3am UTC (el resto —watchdog, seguimientos— va en el de 5 minutos).
const UNA_HORA = 3_600_000;
const periodicos = VOICE_ONLY
  ? null
  : setInterval(async () => {
      if (new Date().getUTCHours() !== 3) return;
      try {
        await runScheduledJobs(env, DAILY_CRON);
      } catch (e) {
        console.error("[cron]", e);
      }
    }, UNA_HORA);

// El estado del servicio (src/estado/), el watchdog y los seguimientos (estos,
// una vez por hora), cada 5 minutos como en las plataformas.
const CINCO_MINUTOS = 300_000;
const estado = VOICE_ONLY
  ? null
  : setInterval(() => {
      runScheduledJobs(env, ESTADO_CRON).catch((e) => console.error("[estado]", e));
    }, CINCO_MINUTOS);

async function apagar(senal: string) {
  console.log(`\n${senal} — cerrando…`);
  if (latido) clearInterval(latido);
  if (periodicos) clearInterval(periodicos);
  if (estado) clearInterval(estado);
  server.close();
  await closeDrivers();
  process.exit(0);
}

process.on("SIGINT", () => void apagar("SIGINT"));
process.on("SIGTERM", () => void apagar("SIGTERM"));
