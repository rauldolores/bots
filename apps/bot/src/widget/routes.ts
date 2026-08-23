// El único endpoint verdaderamente público de la app: cualquier visitante en
// el sitio del dueño llega aquí sin autenticarse más que con la llave pública
// del widget (bot_channels.external_id). Ver docs/portabilidad.md y el plan
// de esta feature para el porqué del polling (no hay camino síncrono en
// ingestMessage()/runTurn()) y del tope anti-abuso.
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "../env";
import { Db } from "../db/client";
import { BotsRepo } from "../db/bots";
import { ConversationsRepo } from "../db/conversations";
import { MessagesRepo } from "../db/messages";
import { ingestMessage } from "../agent/runner";
import { wakeTickAfter } from "../queue/wake";
import { ctxOpcional } from "../hono-utils";
import { resolveWidgetAuth } from "./auth";
import { WIDGET_SCRIPT_JS } from "./script";

export const WIDGET_NEW_CONV_HOURLY_CAP = 30;
const MAX_TEXT_LEN = 4000;

export function widgetScriptHandler(): Response {
  return new Response(WIDGET_SCRIPT_JS, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}

export const widgetApp = new Hono<{ Bindings: Env }>();

widgetApp.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

widgetApp.get("/config", async (c) => {
  const botId = c.req.query("bot") ?? "";
  const key = c.req.query("key") ?? "";
  const db = new Db(c.env.DB);
  const row = await resolveWidgetAuth(db, botId, key);
  if (!row) return c.json({ ok: false, error: "unauthorized" }, 401);
  const bot = await new BotsRepo(db).getById(botId);
  return c.json({
    ok: true,
    businessName: bot?.business_name ?? "Chat",
    bubbleColor: row.config.bubbleColor ?? "#F5C518",
    position: row.config.position ?? "bottom-right",
    greeting: row.config.greeting ?? "",
  });
});

widgetApp.post("/message", async (c) => {
  let body: { botId?: string; key?: string; sessionId?: string; text?: string; displayName?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "bad_json" }, 400);
  }

  const botId = body.botId ?? "";
  const key = body.key ?? "";
  const sessionId = (body.sessionId ?? "").trim();
  const text = (body.text ?? "").trim();

  const db = new Db(c.env.DB);
  const row = await resolveWidgetAuth(db, botId, key);
  if (!row) return c.json({ ok: false, error: "unauthorized" }, 401);
  if (!sessionId || !text) return c.json({ ok: false, error: "missing_fields" }, 400);
  if (text.length > MAX_TEXT_LEN) return c.json({ ok: false, error: "text_too_long" }, 400);

  // spam.ts ya protege por (channel, channelUserId) dentro de ingestMessage,
  // pero un visitante puede generar sessionIds frescos sin límite — eso lo
  // bypasea por completo. Este tope solo se paga la PRIMERA vez que se ve un
  // sessionId (conversación nueva); conversaciones ya existentes no lo pagan.
  const convs = new ConversationsRepo(db, botId);
  const existing = await convs.findByChannelUserId("widget", sessionId);
  if (!existing) {
    const capRow = await db.first<{ n: number }>(
      "SELECT COUNT(*) as n FROM conversations WHERE bot_id = ? AND channel = 'widget' AND started_at > ?",
      [botId, Date.now() - 3600_000],
    );
    if ((capRow?.n ?? 0) >= WIDGET_NEW_CONV_HOURLY_CAP) {
      return c.json({ ok: false, error: "rate_limited" }, 429);
    }
  }

  const r = await ingestMessage(
    c.env,
    { channel: "widget", channelUserId: sessionId, displayName: body.displayName, text },
    botId,
  );
  if (r.scheduledInMs !== null) {
    wakeTickAfter(c.env, ctxOpcional(c), r.scheduledInMs);
  }
  return c.json({ ok: true, scheduledInMs: r.scheduledInMs });
});

widgetApp.get("/messages", async (c) => {
  const botId = c.req.query("bot") ?? "";
  const key = c.req.query("key") ?? "";
  const sessionId = (c.req.query("sessionId") ?? "").trim();
  const after = Number(c.req.query("after") ?? "0") || 0;

  const db = new Db(c.env.DB);
  const row = await resolveWidgetAuth(db, botId, key);
  if (!row) return c.json({ ok: false, error: "unauthorized" }, 401);
  if (!sessionId) return c.json({ ok: false, error: "missing_session" }, 400);

  const convs = new ConversationsRepo(db, botId);
  const conv = await convs.findByChannelUserId("widget", sessionId);
  if (!conv) return c.json({ ok: true, messages: [] });

  const rows = await new MessagesRepo(db, botId).since(conv.id, after);
  return c.json({
    ok: true,
    messages: rows.map((m) => ({ role: m.role, content: m.content, created_at: m.created_at })),
  });
});
