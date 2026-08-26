// Adaptador de servidor Node de larga vida: local, Docker, Railway, Render, Fly
// o un VPS. Es el destino más simple, porque el proceso no muere entre
// peticiones y puede llevar sus propios temporizadores.
//
// Arranque:  DATABASE_URL=postgresql://… node --import tsx src/runtime/node.ts
// (o `npm run start:node`)

import { serve } from "@hono/node-server";
import app, { runScheduledJobs, DAILY_CRON } from "../app";
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
// que se llevan por dentro: una vez por hora, y los nocturnos se auto-filtran
// por la hora (runScheduledJobs solo hace lo pesado con el cron diario).
const UNA_HORA = 3_600_000;
const periodicos = VOICE_ONLY
  ? null
  : setInterval(async () => {
      const esLaHoraNocturna = new Date().getUTCHours() === 3;
      try {
        await runScheduledJobs(env, esLaHoraNocturna ? DAILY_CRON : "hourly");
      } catch (e) {
        console.error("[cron]", e);
      }
    }, UNA_HORA);

async function apagar(senal: string) {
  console.log(`\n${senal} — cerrando…`);
  if (latido) clearInterval(latido);
  if (periodicos) clearInterval(periodicos);
  server.close();
  await closeDrivers();
  process.exit(0);
}

process.on("SIGINT", () => void apagar("SIGINT"));
process.on("SIGTERM", () => void apagar("SIGTERM"));
