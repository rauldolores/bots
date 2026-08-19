import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "./env";
import type { ChannelAdapter, ChannelId } from "./channels/shared";
import { resolveChannelEnv } from "./channels/effectiveEnv";
import { telegramAdapter } from "./channels/telegram";
import { manychatAdapter } from "./channels/manychat";
import { twilioAdapter } from "./channels/twilio";
import { parseMetaEvents, verifyMetaSignature } from "./channels/meta";
import { parseWhatsAppEvents, serveWhatsAppMedia } from "./channels/whatsapp";
import { adminApp } from "./admin/routes";
import { purgeOldMessages } from "./crons/purgeOldMessages";
import { reindexKb } from "./kb/reindex";
import { analyzeConversations } from "./insights/analyzer";
import { Db } from "./db/client";
import { BotsRepo } from "./db/bots";
import { SettingsRepo, SETTING_KEYS } from "./db/settings";
import { resolveBotId } from "./tenant";
import { detectKind } from "./learn/fieldPath";
import { saveCapture, isLearnMode } from "./learn/mapping";
import { tokensMatch } from "./http-auth";
import { apiApp } from "./api";
import { ingestMessage } from "./agent/runner";
import { wakeTickAfter } from "./queue/wake";
import { tick } from "./queue/tick";

/** La expresión del cron nocturno (wrangler.toml, vercel.json). */
export const DAILY_CRON = "0 3 * * *";

/**
 * Cron de un minuto: SOLO mira la cola. Es la red de seguridad por si el
 * `waitUntil` de un webhook murió con su instancia. No arrastra seguimientos ni
 * watchdog — esos son de frecuencia horaria y correrlos 1440 veces al día
 * costaría de más sin ganar nada.
 */
export const TICK_CRON = "* * * * *";

const app = new Hono<{ Bindings: Env }>();

/**
 * El contexto de ejecución, si la plataforma lo tiene.
 *
 * Hono LANZA al acceder a `c.executionCtx` cuando no existe (que es el caso en
 * un servidor Node), así que hay que envolverlo. Sin esto, el webhook devolvía
 * 500 y el canal lo reintentaba: el cliente terminaba con la respuesta
 * duplicada.
 */
function ctxOpcional(c: { executionCtx?: unknown }): { waitUntil(p: Promise<unknown>): void } | null {
  try {
    const ctx = c.executionCtx as { waitUntil?: unknown } | undefined;
    return ctx && typeof ctx.waitUntil === "function" ? (ctx as any) : null;
  } catch {
    return null;
  }
}

app.get("/health", (c) => c.text("ok", 200));

// Parsea el payload del proveedor con el adaptador del canal y lo mete al
// buffer del agente, que programa el turno en la cola de Postgres. El webhook
// responde de inmediato: pensar y contestar ocurre en el tick.
async function routeToAgent(
  c: {
    req: { raw: Request };
    env: Env;
    text: (t: string, s: number) => Response;
    executionCtx?: unknown;
  },
  adapter: ChannelAdapter,
  channel: ChannelId,
  /**
   * F4 de docs/multitenancy.md: viene de la URL en las rutas nuevas
   * (/webhooks/<canal>/<botId>). Ausente en las rutas viejas, que siguen
   * resolviendo el único bot del despliegue como hasta ahora.
   */
  botId?: string,
) {
  try {
    let env = c.env;
    if (botId) {
      // botId sale de la URL, así que puede ser cualquier cosa que alguien
      // haya escrito — validar que exista evita crear conversaciones
      // huérfanas bajo un bot_id que no es de nadie.
      const exists = await new BotsRepo(new Db(env.DB)).getById(botId);
      if (!exists) return c.text("bot not found", 404);
      // El env efectivo trae el token DE ESTE bot (Vault) si ya está
      // conectado; si no, cae al env del despliegue — mismo comportamiento
      // que las rutas viejas mientras el canal no se haya migrado.
      env = await resolveChannelEnv(env, botId, channel);
    }
    const msg = await adapter.parseIncoming(c.req.raw, env);
    const r = await ingestMessage(env, msg, botId);
    if (r.scheduledInMs !== null) {
      wakeTickAfter(env, ctxOpcional(c), r.scheduledInMs);
    }
    // Twilio treats the webhook's HTTP body as a reply to send. The real reply
    // is delivered asynchronously via the REST API, so ack with empty TwiML
    // (`<Response></Response>`) to tell Twilio to send nothing. Other channels
    // ignore the body, so a plain "ok" is fine for them.
    if (msg.channel === "twilio") {
      return new Response("<Response></Response>", {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      });
    }
    return c.text("ok", 200);
  } catch (e: any) {
    console.error("webhook error:", e);
    return c.text(`err: ${e?.message ?? e}`, 500);
  }
}

app.post("/webhooks/telegram", (c) => routeToAgent(c, telegramAdapter, "telegram"));
// F4: un webhook por bot. La ruta vieja de arriba sigue viva (M5,
// docs/multitenancy.md) mientras el bot actual no re-registre su URL en
// BotFather — nadie tiene que migrar el día que esto se despliega.
app.post("/webhooks/telegram/:botId", (c) =>
  routeToAgent(c, telegramAdapter, "telegram", c.req.param("botId")),
);
app.post("/webhooks/manychat", (c) => routeToAgent(c, manychatAdapter, "manychat"));
app.post("/webhooks/manychat/:botId", (c) =>
  routeToAgent(c, manychatAdapter, "manychat", c.req.param("botId")),
);
// WhatsApp (Twilio): rutea el mensaje entrante al bot de clientes (Claude). El
// body se lee UNA vez; ack con TwiML vacío para que Twilio no reenvíe el cuerpo
// como mensaje.
app.post("/webhooks/twilio", async (c) => {
  let msg;
  try {
    msg = await twilioAdapter.parseIncoming(c.req.raw, c.env);
  } catch (e) {
    console.error("twilio parse error:", e);
    return new Response("<Response></Response>", { status: 200, headers: { "Content-Type": "text/xml" } });
  }
  await ingestMessage(c.env, msg)
    .then((r) => {
      if (r.scheduledInMs !== null) wakeTickAfter(c.env, ctxOpcional(c), r.scheduledInMs);
    })
    .catch((e) => console.error("ingest:", e));
  return new Response("<Response></Response>", { status: 200, headers: { "Content-Type": "text/xml" } });
});

// --- Meta oficial (Facebook Messenger + Instagram DMs, sin ManyChat) --------
// GET = handshake de verificación de Meta: devuelve hub.challenge si el
// hub.verify_token coincide con nuestro secreto. Se llama una vez al configurar
// el webhook en la app de Meta.
app.get("/webhooks/meta", (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");
  if (mode === "subscribe" && token && token === c.env.META_VERIFY_TOKEN) {
    return c.text(challenge ?? "", 200);
  }
  return c.text("forbidden", 403);
});

// POST = eventos de mensajes. Meta firma el cuerpo con el App Secret; validamos
// la firma (fail-closed) antes de procesar. Un POST puede traer varios mensajes
// (varias paginas/usuarios): encola cada uno por separado. Responde 200
// rápido para que Meta no reintente.
app.post("/webhooks/meta", async (c) => {
  const raw = await c.req.text();
  const sig = c.req.header("x-hub-signature-256");
  // Messenger (app de Facebook) e Instagram (IG Login) pueden firmar con App
  // Secrets DISTINTOS aunque sea la misma app de Meta. Aceptamos la firma si
  // cuadra con cualquiera de los dos secretos configurados (fail-closed si con
  // ninguno). Así un solo webhook /webhooks/meta sirve para ambos canales.
  const valid =
    (!!c.env.META_APP_SECRET && (await verifyMetaSignature(raw, sig, c.env.META_APP_SECRET))) ||
    (!!c.env.INSTAGRAM_APP_SECRET && (await verifyMetaSignature(raw, sig, c.env.INSTAGRAM_APP_SECRET)));
  if (!valid) return c.text("bad signature", 403);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.text("bad json", 400);
  }
  // Kill-switch del canal oficial de Instagram (IG_OFFICIAL="off"): se ignora
  // TODO lo de IG por esta vía (DMs) — el bot de IG vive únicamente en ManyChat
  // (decisión de diseño). Messenger (object === "page") no se ve
  // afectado. Para reactivar: quitar la var y redeploy.
  if ((body as { object?: string }).object === "instagram" && c.env.IG_OFFICIAL === "off") {
    return c.text("EVENT_RECEIVED", 200);
  }

  for (const msg of parseMetaEvents(body as any)) {
    // Anti-duplicado: cuando IG_DM_SOURCE="manychat", los DMs de Instagram
    // entran SOLO por el webhook de ManyChat — el canal oficial los ignora
    // (si no, cada DM se procesa DOBLE: 2x LLM, 2x respuestas al lead y
    // colisiones de rate limit en ráfagas de historias).
    if (msg.channel === "instagram" && c.env.IG_DM_SOURCE === "manychat") continue;
    const r = await ingestMessage(c.env, msg);
    if (r.scheduledInMs !== null) wakeTickAfter(c.env, ctxOpcional(c), r.scheduledInMs);
  }
  return c.text("EVENT_RECEIVED", 200);
});

// --- WhatsApp OFICIAL (Cloud API de Meta, sin Twilio/BSP) -------------------
// GET = handshake de verificación (igual que Meta). Acepta el WHATSAPP_VERIFY_TOKEN
// propio o, si no se configuró, cae al META_VERIFY_TOKEN (misma app de Meta).
app.get("/webhooks/whatsapp", (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");
  const expected = c.env.WHATSAPP_VERIFY_TOKEN || c.env.META_VERIFY_TOKEN;
  if (mode === "subscribe" && token && expected && token === expected) {
    return c.text(challenge ?? "", 200);
  }
  return c.text("forbidden", 403);
});

// POST = mensajes entrantes. Firma X-Hub-Signature-256 con el App Secret de
// WhatsApp (o el de Meta si comparten app). Un POST puede traer varios mensajes.
app.post("/webhooks/whatsapp", async (c) => {
  const raw = await c.req.text();
  const sig = c.req.header("x-hub-signature-256");
  const secret = c.env.WHATSAPP_APP_SECRET || c.env.META_APP_SECRET;
  const valid = !!secret && (await verifyMetaSignature(raw, sig, secret));
  if (!valid) return c.text("bad signature", 403);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.text("bad json", 400);
  }
  const origin = c.env.DASHBOARD_BASE_URL || new URL(c.req.url).origin;
  for (const msg of await parseWhatsAppEvents(body as any, c.env, origin)) {
    const r = await ingestMessage(c.env, msg);
    if (r.scheduledInMs !== null) wakeTickAfter(c.env, ctxOpcional(c), r.scheduledInMs);
  }
  return c.text("EVENT_RECEIVED", 200);
});

// Proxy FIRMADO del media entrante de WhatsApp Cloud (audio/imagen). Hace el
// media públicamente fetchable (para transcribe/vision) sin exponer el token.
app.get("/webhooks/whatsapp/media/:id", (c) =>
  serveWhatsAppMedia(c.req.param("id"), c.req.query("exp") ?? null, c.req.query("sig") ?? null, c.env),
);

// Universal webhook LEARN endpoint. When learn mode is ON for `:channel`, this
// captures a real payload (classified by media kind) so the bot can later infer
// where each field lives — instead of hardcoding one app's contract. It NEVER
// runs the LLM; it only observes. When learn mode is OFF it returns 409 so the
// caller knows nothing was captured.
app.post("/webhooks/learn/:channel", async (c) => {
  const channel = c.req.param("channel");
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid json" }, 400);
  }

  const learnDb = new Db(c.env.DB);
  const repo = new SettingsRepo(learnDb, await resolveBotId(learnDb));
  const kind = detectKind(payload);

  if (!(await isLearnMode(repo, channel))) {
    return c.json({ ok: false, error: "learn mode off" }, 409);
  }

  await saveCapture(repo, channel, kind, payload);
  return c.json({ ok: true, captured: kind, channel }, 200);
});

// Admin dashboard — Basic Auth guarded sub-app mounted at /admin/*.
app.route("/admin", adminApp);

// Control-plane API — Bearer-guarded (CONTROL_PLANE_TOKEN) read-only sub-app
// mounted at /api/* for a future hosted control plane (health + metrics).
app.route("/api", apiApp);

// KB reindex — embeds scripts/kb-fixtures.json into pgvector. Guarded by the
// KB_REINDEX_TOKEN secret via the X-Reindex-Token header. Trigger after deploy:
//   curl -X POST https://<worker>/kb/reindex -H "X-Reindex-Token: <token>"
app.post("/kb/reindex", async (c) => {
  const provided = c.req.header("X-Reindex-Token") ?? "";
  const expected = c.env.KB_REINDEX_TOKEN ?? "";
  if (!expected || !tokensMatch(provided, expected)) {
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }
  const r = await reindexKb(c.env);
  return c.json({ ok: true, indexed: r.indexed }, 200);
});

// Crons por HTTP. Existen para las plataformas cuyo programador dispara una
// PETICIÓN (Vercel Cron) en vez de invocar un handler, como hace Cloudflare. En
// un servidor Node no se usan: el proceso corre sus propios temporizadores.
//
// Se acepta el token por `X-Tick-Token` o por `Authorization: Bearer` — Vercel
// Cron manda lo segundo y no deja elegir cabecera.
//
// Fail-closed: sin TICK_TOKEN configurado quedan cerrados. Abiertos, cualquiera
// podría forzar turnos del agente y con ello gasto de LLM.
function cronAutorizado(c: { req: { header: (n: string) => string | undefined }; env: Env }): boolean {
  const expected = c.env.TICK_TOKEN ?? "";
  if (!expected) return false;
  const directo = c.req.header("X-Tick-Token") ?? "";
  const bearer = (c.req.header("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  return tokensMatch(directo, expected) || tokensMatch(bearer, expected);
}

// Solo mira la cola. Es el que va cada minuto.
app.on(["GET", "POST"], "/cron/tick", async (c) => {
  if (!cronAutorizado(c)) return c.json({ ok: false, error: "unauthorized" }, 401);
  return c.json({ ok: true, ...(await tick(c.env)) }, 200);
});

// Los trabajos nocturnos completos (purga, insights, flywheel).
app.on(["GET", "POST"], "/cron/nightly", async (c) => {
  if (!cronAutorizado(c)) return c.json({ ok: false, error: "unauthorized" }, 401);
  await runScheduledJobs(c.env, DAILY_CRON);
  return c.json({ ok: true }, 200);
});

app.notFound((c) => c.text("not found", 404));

// Sin esto, cualquier error dentro de una ruta sale como un 500 mudo y hay que
// adivinar. El detalle va al log del servidor, nunca al cliente.
app.onError((err, c) => {
  // Hono señala los errores HTTP ESPERADOS lanzando una HTTPException que ya
  // trae su respuesta — el 401 con WWW-Authenticate del Basic Auth, por
  // ejemplo. Convertirlos en 500 rompía el desafío de autenticación: el panel
  // respondía "error del servidor" y el navegador nunca pedía la contraseña.
  if (err instanceof HTTPException) return err.getResponse();
  console.error(`[${c.req.method} ${new URL(c.req.url).pathname}]`, err);
  return c.text("Internal Server Error", 500);
});

/**
 * Trabajos periódicos. Los llama el cron de cada plataforma (ver src/runtime/).
 *
 * `cron` es la expresión que disparó la corrida, o undefined si el disparador
 * no la conoce. Los trabajos nocturnos solo corren en el tick diario: un
 * disparador más frecuente no debe purgar ni analizar de más.
 */
export async function runScheduledJobs(env: Env, cron?: string): Promise<void> {
  // La cola se mira SIEMPRE: es lo único que no puede esperar.
  await tick(env).catch((e) => console.error("tick:", e));

  // El cron de un minuto termina aquí.
  if (cron === TICK_CRON) return;

  // Follow-up bot: UN mensaje breve de seguimiento a leads que lo ameritan
  // (venta abierta / 4+ preguntas), dentro de la ventana de 24h y máximo una
  // vez por conversación. Acotado por caps internos.
  const { runFollowups } = await import("./followup/run");
  await runFollowups(env).catch((e) => console.error("followups:", e));

  // Watchdog: si el bot está fallando en cadena (3+ "Algo falló" en 30 min),
  // avisa al dueño por su canal de handoff. Throttle 6h. Lo ÚNICO que debe
  // despertarlo en la noche.
  const { checkBotHealth } = await import("./watchdog");
  await checkBotHealth(env).catch((e) => console.error("watchdog:", e));

  if (cron && cron !== DAILY_CRON) return;

  // Purga los mensajes de más de 90 días.
  await purgeOldMessages(env);
  // Corrida nocturna del Analista de insights (F2). No debe tumbar la purga.
  await analyzeConversations(env, { limit: 50 }).catch((e) => console.error("insights:", e));
  // Flywheel (F5): detecta huecos de KB y lecciones de takeovers → propone
  // mejoras en /admin/mejoras. Corre DESPUÉS del analizador (usa su output).
  const { runFlywheel } = await import("./flywheel/detect");
  await runFlywheel(env).catch((e) => console.error("flywheel:", e));
  // Modo COPILOTO (autonomy_level="copilot"): auto-aplica las mejoras seguras
  // detectadas (lecciones + KB sin huecos). Lo delicado espera al dueño.
  try {
    const copilotoDb = new Db(env.DB);
    const level = await new SettingsRepo(copilotoDb, await resolveBotId(copilotoDb)).get(
      SETTING_KEYS.autonomyLevel,
    );
    if (level === "copilot") {
      const { autoApplyPending } = await import("./flywheel/apply");
      await autoApplyPending(env);
    }
  } catch (e) {
    console.error("copiloto:", e);
  }
}

export { app };
export default app;
