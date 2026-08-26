// F8: la API pública de habilidades.
//
// Se monta en /v1/* y NO bajo /api/* a propósito: ese grupo ya tiene el
// middleware global de CONTROL_PLANE_TOKEN (un solo token para todo el
// despliegue) y además es de un solo tenant — sus consultas no filtran por
// bot_id. Aquí cada llave identifica a UN bot.
//
// Sin CORS: esto es tráfico servidor-a-servidor. Una llave de API no debe
// vivir en el navegador; para eso está el widget, que usa una llave pública.
import { Hono } from "hono";
import type { Env } from "../env";
import { Db } from "../db/client";
import { BotSkillsRepo } from "../db/skills";
import { SkillRunsRepo } from "../db/skillRuns";
import { BotApiKeysRepo } from "../db/apiKeys";
import { AiUsageRepo } from "../db/aiUsage";
import { WorkJobsRepo } from "../db/workJobs";
import { resolveApiCaller, bearerFrom, type ApiCaller } from "./auth";
import { runSkill, SkillBudgetExceededError } from "./run";
import { hmacHex } from "./sign";

/** Corridas por bot y por hora. Constante de código, igual que el tope de spam.ts. */
export const SKILL_HOURLY_CAP = 120;
const MAX_INPUT_CHARS = 20_000;
/** Tope del modo síncrono. Vercel corta la función al minuto; mejor fallar nosotros con un mensaje claro. */
const SYNC_TIMEOUT_MS = 45_000;

export const skillsApp = new Hono<{ Bindings: Env }>();

async function authenticate(c: any): Promise<ApiCaller | null> {
  const db = new Db(c.env.DB);
  return resolveApiCaller(db, bearerFrom(c.req.raw));
}

/** Catálogo de habilidades — permite que un integrador descubra qué sabe hacer este agente. */
skillsApp.get("/skills", async (c) => {
  const caller = await authenticate(c);
  if (!caller) return c.json({ ok: false, error: "unauthorized" }, 401);

  const db = new Db(c.env.DB);
  const skills = await new BotSkillsRepo(db, caller.botId).listEnabled();
  return c.json({
    ok: true,
    skills: skills.map((s) => ({
      slug: s.slug,
      name: s.name,
      output_fields: s.output_fields,
    })),
  });
});

skillsApp.get("/runs/:id", async (c) => {
  const caller = await authenticate(c);
  if (!caller) return c.json({ ok: false, error: "unauthorized" }, 401);

  const db = new Db(c.env.DB);
  const run = await new SkillRunsRepo(db, caller.botId).getById(c.req.param("id"));
  if (!run) return c.json({ ok: false, error: "not_found" }, 404);

  return c.json({
    ok: true,
    run_id: run.id,
    status: run.status,
    result: run.output,
    error: run.error,
    created_at: run.created_at,
    finished_at: run.finished_at,
  });
});

skillsApp.post("/skills/:slug", async (c) => {
  const caller = await authenticate(c);
  if (!caller) return c.json({ ok: false, error: "unauthorized" }, 401);

  const db = new Db(c.env.DB);
  const botId = caller.botId;

  let body: { input?: unknown; callback_url?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "bad_json" }, 400);
  }

  // La entrada puede venir como texto o como objeto (un sistema mandando su
  // propio JSON) — se normaliza a texto para el modelo.
  const rawInput = body.input;
  const input = typeof rawInput === "string" ? rawInput : JSON.stringify(rawInput ?? "", null, 2);
  if (!input.trim() || input === '""') return c.json({ ok: false, error: "missing_input" }, 400);
  if (input.length > MAX_INPUT_CHARS) return c.json({ ok: false, error: "input_too_long" }, 400);

  const callbackUrl = typeof body.callback_url === "string" ? body.callback_url.trim() : "";
  if (callbackUrl) {
    try {
      const u = new URL(callbackUrl);
      if (u.protocol !== "https:" && u.protocol !== "http:") {
        return c.json({ ok: false, error: "bad_callback_url" }, 400);
      }
    } catch {
      return c.json({ ok: false, error: "bad_callback_url" }, 400);
    }
  }

  const skill = await new BotSkillsRepo(db, botId).getEnabledBySlug(c.req.param("slug"));
  if (!skill) return c.json({ ok: false, error: "skill_not_found" }, 404);

  // Tope por hora. Este endpoint es tan alcanzable como el del widget y hoy no
  // hay ningún rate-limit en el resto del repo — sin esto, una llave filtrada
  // gastaría el presupuesto de IA del dueño en minutos.
  const usage = new AiUsageRepo(db, botId);
  const usedLastHour = await usage.countSince("skill", Date.now() - 3600_000);
  if (usedLastHour >= SKILL_HOURLY_CAP) {
    return c.json({ ok: false, error: "rate_limited" }, 429);
  }

  const runs = new SkillRunsRepo(db, botId);
  const runId = await runs.start({
    skillId: skill.id,
    apiKeyId: caller.apiKey.id,
    input,
    callbackUrl: callbackUrl || null,
  });
  await new BotApiKeysRepo(db).touchLastUsed(caller.apiKey.id).catch(() => {});

  // Modo asíncrono: se responde de inmediato y el tick lo procesa. Es lo que
  // permite tareas largas sin pelear con el maxDuration de la plataforma.
  if (callbackUrl) {
    await new WorkJobsRepo(db).enqueue({
      botId,
      kind: "skill_run",
      payload: { runId, skillId: skill.id, input, callbackUrl },
    });
    return c.json({ ok: true, run_id: runId, status: "running" }, 202);
  }

  try {
    const outcome = await Promise.race([
      runSkill(c.env, botId, skill, input, { runId }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), SYNC_TIMEOUT_MS),
      ),
    ]);
    await runs.finishOk(runId, outcome.output);
    return c.json({ ok: true, run_id: runId, result: outcome.output });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await runs.finishError(runId, msg).catch(() => {});
    if (e instanceof SkillBudgetExceededError) {
      return c.json({ ok: false, run_id: runId, error: "budget_exceeded", detail: msg }, 402);
    }
    if (msg === "timeout") {
      return c.json(
        {
          ok: false,
          run_id: runId,
          error: "timeout",
          detail: "La tarea tardó demasiado. Usa callback_url para tareas largas.",
        },
        504,
      );
    }
    return c.json({ ok: false, run_id: runId, error: "execution_failed", detail: msg }, 502);
  }
});

/**
 * Procesa las corridas asíncronas pendientes. Lo llama el tick, igual que
 * processCampaignJobs — un lote chico por corrida para no tumbar nunca el
 * tick de turnos, que es lo que de verdad no puede esperar.
 */
export async function processSkillJobs(env: Env, limit: number): Promise<{ done: number }> {
  const db = new Db(env.DB);
  const jobs = new WorkJobsRepo(db);
  const claimed = await jobs.claimDue(limit, "skill_run");
  let done = 0;

  for (const job of claimed) {
    const { runId, skillId, input, callbackUrl } = job.payload as {
      runId: string;
      skillId: string;
      input: string;
      callbackUrl: string;
    };
    const runs = new SkillRunsRepo(db, job.bot_id);

    try {
      const skill = await new BotSkillsRepo(db, job.bot_id).getById(skillId);
      if (!skill) throw new Error("La habilidad ya no existe.");

      const outcome = await runSkill(env, job.bot_id, skill, input, { runId });
      await runs.finishOk(runId, outcome.output);
      await deliverCallback(db, callbackUrl, runId, { ok: true, run_id: runId, result: outcome.output }, runs);
      await jobs.complete(job.id);
      done++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[processSkillJobs] ${job.id} falló:`, msg);
      if (job.attempts >= 3) {
        await runs.finishError(runId, msg).catch(() => {});
        await deliverCallback(
          db,
          callbackUrl,
          runId,
          { ok: false, run_id: runId, error: "execution_failed", detail: msg },
          runs,
        );
        await jobs.complete(job.id);
      } else {
        await jobs.fail(job.id, msg, 30_000);
      }
    }
  }

  return { done };
}

/**
 * Entrega el resultado al sistema que llamó, firmado con HMAC-SHA256.
 *
 * La llave del HMAC es el SHA-256 de la llave de API — o sea, el mismo valor
 * que guardamos en key_hash. Quien llama puede calcularlo con su propia llave
 * y verificar la firma, y nosotros nunca tuvimos que guardar un secreto extra.
 */
async function deliverCallback(
  db: Db,
  url: string,
  runId: string,
  payload: Record<string, unknown>,
  runs: SkillRunsRepo,
): Promise<void> {
  if (!url) return;
  try {
    const run = await runs.getById(runId);
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { "Content-Type": "application/json" };

    const secret = run?.api_key_id
      ? await new BotApiKeysRepo(db).hashById(run.api_key_id)
      : null;
    if (secret) headers["X-Nodia-Signature"] = `sha256=${await hmacHex(secret, body)}`;

    const res = await fetch(url, { method: "POST", headers, body });
    await runs.setCallbackStatus(runId, res.status).catch(() => {});
  } catch (e) {
    console.error(`[deliverCallback] no se pudo entregar ${runId}:`, e);
    await runs.setCallbackStatus(runId, 0).catch(() => {});
  }
}
