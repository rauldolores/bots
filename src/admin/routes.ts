/**
 * Admin dashboard routes (Hono sub-app mounted at `/admin`).
 *
 * Auth is HTTP Basic Auth (owner override of the original magic-link plan):
 * every route is guarded by `adminAuth(env)`, which prompts the browser's
 * native Basic Auth dialog. Username is always "admin", password lives in the
 * `DASHBOARD_PASSWORD` secret. There are NO /login or /logout routes — Basic
 * Auth does not need them.
 *
 * Because the Basic Auth middleware needs the per-request `Env` (to read
 * `DASHBOARD_PASSWORD` from the binding), it is applied inside a wildcard
 * middleware that has access to `c.env` rather than at module-init time.
 */
import { parsePeerBots } from "./projects";
import { Hono, type Context } from "hono";
import { generateText } from "ai";
import { createModel } from "../llm/provider";
import { loadLlmOverrides } from "../settings-loader";
import type { Env } from "../env";
import { adminAuth } from "./auth";
import { layout, renderUpgrade } from "./views/layout";
import { isProTier } from "../config";
import { renderOverview } from "./views/overview";
import { renderStats } from "./views/stats";
import { renderCosts } from "./views/costs";
import {
  renderInbox,
  renderInboxList,
  renderThreadLive,
  renderSuggestionBox,
} from "./views/conversations";
import { pickAdapter } from "../replies/sender";
import { channelLabel } from "../channels/labels";
import type { ChannelId } from "../channels/shared";
import { renderInsights } from "./views/insights";
import { analyzeConversations } from "../insights/analyzer";
import { renderAgentePage, renderAgenteCanvas, renderNodeModal, toggleTool, toastOob } from "./views/agente";
import { renderKbList, renderKbEditor } from "./views/kb";
import { KbDocsRepo, indexDoc, removeDocVectors, reindexAll, MAX_DOC_CHARS } from "../kb/docs";
import { renderMejoras } from "./views/mejoras";
import { runFlywheel, getLessons, saveLessons } from "../flywheel/detect";
import { applySuggestion, dismissSuggestion } from "../flywheel/apply";
import { renderLeads, exportLeadsCsv } from "./views/leads";
import { renderTickets } from "./views/tickets";
import { renderConfig } from "./views/config";
import {
  renderConexiones,
  renderConnectModal,
  renderConexionesGrid,
  connectChannel,
  disconnectChannel,
} from "./views/conexiones";
import { renderCampanas } from "./views/campanas";
import { sendCampaign, createHandoffTemplate, contentApprovalStatus } from "../campaigns";
import { Db } from "../db/client";
import { LeadsRepo, type Lead } from "../db/leads";
import { TicketsRepo } from "../db/tickets";
import { ConversationsRepo } from "../db/conversations";
import { BotsRepo } from "../db/bots";
import { MessagesRepo } from "../db/messages";
import { SettingsRepo, SETTING_KEYS, type SettingKey } from "../db/settings";
import { CONTROLS, levelToValue } from "./control-levels";
import { systemPromptFromEnv } from "../system-prompt";
import { renderBusinessContext } from "../businessContext";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import {
  kontroliaConfig,
  buildAuthorizeUrl,
  exchangeCode,
  refreshSession,
  verifyAccessToken,
  listMemberships,
  switchActiveOrganization,
  SESSION_COOKIE,
  VERIFIER_COOKIE,
  type KontroliaSession,
} from "./kontroliaAuth";
import { resolveAdminTenant, BOT_COOKIE, NoBotsInOrganizationError, type AdminBindings } from "./tenantContext";
import type { KontroliaTokenClaims } from "@kontrolia/shared";
import { renderCreateBotPage } from "./views/onboarding";

export const adminApp = new Hono<AdminBindings>();

// Rutas del propio login: NUNCA detrás del guard (si lo estuvieran, entrar a
// /admin/login exigiría ya estar logueado — un candado cerrado con la llave
// adentro).
// Comparación por sufijo, no por igualdad exacta: c.req.path trae el prefijo
// /admin cuando adminApp corre montada bajo la app principal (producción),
// pero NO cuando se prueba adminApp.fetch() directo (así corren los tests de
// este archivo) — el sufijo es correcto en los dos casos.
const AUTH_EXEMPT_SUFFIXES = ["/login", "/oauth/callback", "/logout"];
function isAuthExempt(path: string): boolean {
  return AUTH_EXEMPT_SUFFIXES.some((s) => path.endsWith(s));
}

// Necesitan sesión de KontrolIA (por eso NO están en AUTH_EXEMPT) pero NO
// necesitan que ya exista un bot resuelto — son justo la salida de una
// organización sin bots. Si no se eximen aquí, una organización sin bots
// nunca puede cambiarse a otra: setTenantContext() lanzaría antes de llegar
// siquiera a la ruta que resuelve el problema.
//
// /projects NO va aquí a propósito: si la organización SÍ tiene bots, /projects
// necesita el botId resuelto normal (para "current"); solo cuando la
// organización está vacía se salta el redirect (ver el catch de abajo) — si no,
// /projects también tenía botId=undefined SIEMPRE, rompiendo el caso normal.
const TENANT_EXEMPT_SUFFIXES = ["/switch-org", "/switch-bot", "/bots/new", "/bots"];
function isTenantExempt(path: string): boolean {
  return TENANT_EXEMPT_SUFFIXES.some((s) => path.endsWith(s));
}

function redirectUri(env: Env): string {
  return `${(env.DASHBOARD_BASE_URL ?? "").replace(/\/$/, "")}/admin/oauth/callback`;
}

/**
 * Guard combinado del panel (F5, docs/multitenancy.md):
 *   1. Sesión de KontrolIA Auth válida (cookie) → pasa.
 *   2. Si no, pero llegó un header Basic Auth → se valida como siempre
 *      (compatibilidad: navegadores con la contraseña ya guardada, curl,
 *      scripts). Es la salida de emergencia si KontrolIA Auth falla.
 *   3. Si no hay nada de lo anterior:
 *      - con KontrolIA configurado → redirige a /admin/login (login nuevo).
 *      - sin configurar → cae al Basic Auth de siempre (challenge del navegador),
 *        cero cambio de comportamiento para quien no activó esto.
 */
type HonoContext = Context<AdminBindings>;

type GuardResult =
  // ya autenticado con KontrolIA — claims.organization_id manda cuál bot ve
  | { kind: "pass"; claims: KontroliaTokenClaims }
  | { kind: "pass-public" } // DASHBOARD_PUBLIC=1 — sin sesión, sin organización
  | { kind: "check-basic" } // sin sesión de KontrolIA — que decida el Basic Auth clásico
  | { kind: "redirect"; to: string };

async function guardAdmin(c: HonoContext): Promise<GuardResult> {
  const env = c.env;
  if (env.DASHBOARD_PUBLIC === "1") return { kind: "pass-public" };

  // Salida de emergencia: ?basic=1 fuerza el prompt clásico del navegador
  // aunque KontrolIA Auth esté configurado — por si el login nuevo falla o
  // el dueño simplemente prefiere la contraseña de siempre.
  if (c.req.query("basic") === "1") return { kind: "check-basic" };

  const cfg = kontroliaConfig(env);
  if (cfg) {
    const raw = getCookie(c, SESSION_COOKIE);
    if (raw) {
      const session = JSON.parse(raw) as KontroliaSession;
      let accessToken = session.accessToken;
      if (session.expiresAt < Date.now()) {
        const refreshed = await refreshSession(cfg, session.refreshToken);
        accessToken = refreshed?.accessToken ?? "";
        if (refreshed) {
          setCookie(c, SESSION_COOKIE, JSON.stringify(refreshed), {
            httpOnly: true,
            secure: true,
            sameSite: "Lax",
            maxAge: 60 * 60 * 24 * 30,
          });
        }
      }
      if (accessToken) {
        const verified = await verifyAccessToken(cfg, accessToken);
        if (verified) return { kind: "pass", claims: verified.claims };
      }
    }
  }

  const authHeader = c.req.header("authorization");
  if (authHeader?.startsWith("Basic ")) return { kind: "check-basic" };

  if (cfg) {
    const url = new URL(c.req.url);
    return { kind: "redirect", to: `/admin/login?next=${encodeURIComponent(url.pathname)}` };
  }
  return { kind: "check-basic" }; // sin KontrolIA configurado: Basic Auth clásico, cero cambio
}

/** Resuelve y guarda en el contexto el bot/organización de este request — una sola vez, aquí. */
async function setTenantContext(c: HonoContext, organizationId: string | null): Promise<void> {
  const db = new Db(c.env.DB);
  const tenant = await resolveAdminTenant(c, db, organizationId);
  c.set("botId", tenant.botId);
  c.set("kontroliaOrgId", tenant.organizationId);
}

adminApp.use("*", async (c, next) => {
  if (isAuthExempt(c.req.path)) return next();
  const result = await guardAdmin(c);
  if (result.kind === "redirect") return c.redirect(result.to, 302);
  if (result.kind === "check-basic") {
    return adminAuth(c.env)(c, async () => {
      await setTenantContext(c, null);
      await next();
    });
  }
  if (result.kind === "pass") {
    c.set("kontroliaClaims", result.claims);
    if (isTenantExempt(c.req.path)) {
      // switch-org/switch-bot: no necesitan botId resuelto (de eso se trata
      // la ruta), pero switch-bot SÍ necesita saber la organización activa
      // para validar que el bot elegido le pertenece.
      c.set("kontroliaOrgId", result.claims.organization_id);
      return next();
    }
    try {
      await setTenantContext(c, result.claims.organization_id);
    } catch (e) {
      if (e instanceof NoBotsInOrganizationError) {
        // /projects es lo que el header hace fetch() para armar el selector —
        // si esto rebotara a /bots/new (HTML, no JSON), el script fallaría en
        // silencio y el selector desaparecería justo cuando más se necesita:
        // una organización vacía atrapada sin forma de cambiarse a otra (bug
        // real, encontrado en vivo). botId queda sin resolver — BotsRepo lo
        // tolera (ver getById) y el bot activo simplemente no existe todavía.
        if (c.req.path.endsWith("/projects")) {
          c.set("kontroliaOrgId", result.claims.organization_id);
          return next();
        }
        return c.redirect("/admin/bots/new", 302);
      }
      throw e;
    }
    return next();
  }
  // pass-public (DASHBOARD_PUBLIC=1): sin sesión, mismo fallback que Basic Auth.
  await setTenantContext(c, null);
  return next();
});

// --- Login con KontrolIA Auth (F5) ------------------------------------------
//
// auth-server ES el GoTrue del proyecto de Supabase compartido — no hay
// redirect a un servidor "genérico", es directo al /authorize de ese
// proyecto. Sin JS de navegador: todo el intercambio ocurre en el servidor.

adminApp.get("/login", async (c) => {
  const cfg = kontroliaConfig(c.env);
  if (!cfg) return c.text("KontrolIA Auth no está configurado en este despliegue.", 501);
  const next = c.req.query("next") ?? "/admin/overview";
  const { url, codeVerifier } = await buildAuthorizeUrl(cfg, redirectUri(c.env), next);
  setCookie(c, VERIFIER_COOKIE, codeVerifier, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: 600, // 10 min — el tiempo que dura el ida y vuelta a auth-server
  });
  return c.redirect(url, 302);
});

adminApp.get("/oauth/callback", async (c) => {
  const cfg = kontroliaConfig(c.env);
  if (!cfg) return c.text("KontrolIA Auth no está configurado en este despliegue.", 501);
  const code = c.req.query("code");
  const codeVerifier = getCookie(c, VERIFIER_COOKIE);
  if (!code || !codeVerifier) {
    return c.text("Falta el código de autorización o expiró el intento de login — vuelve a intentar.", 400);
  }
  let session;
  try {
    session = await exchangeCode(cfg, code, codeVerifier, redirectUri(c.env));
  } catch (e) {
    console.error("[oauth callback]", e);
    return c.text("No se pudo completar el login con KontrolIA Auth.", 502);
  }
  deleteCookie(c, VERIFIER_COOKIE);
  setCookie(c, SESSION_COOKIE, JSON.stringify(session), {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: 60 * 60 * 24 * 30, // 30 días — el refresh_token es lo que en realidad manda
  });
  const next = c.req.query("state") || "/admin/overview";
  return c.redirect(next, 302);
});

adminApp.post("/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE);
  return c.redirect("/admin/login", 302);
});

/** Settings del bot de este request (ver setTenantContext). */
async function settingsFor(c: HonoContext): Promise<SettingsRepo> {
  return new SettingsRepo(new Db(c.env.DB), c.get("botId"));
}

// Gate de tier: el panel free ve el nav Pro bloqueado; si aun así navega a una
// ruta Pro (URL directa, bookmark, click al item bloqueado), servimos la página
// de upgrade en vez de la vista real. Los datos Pro nunca se exponen en free.
const PRO_GATE: Array<[string, string]> = [
  ["/admin/insights", "Insights"],
  ["/admin/stats", "Estadísticas"],
  ["/admin/costs", "Costos"],
  ["/admin/mejoras", "Mejoras"],
  ["/admin/campanas", "Campañas"],
];
adminApp.use("*", async (c, next) => {
  // botId no existe todavía en /login, /oauth/callback, ni en switch-org/switch-bot
  // (que corren precisamente ANTES de que haya un bot resuelto — ver arriba).
  if (isAuthExempt(c.req.path) || isTenantExempt(c.req.path)) return next();
  const gateDb = new Db(c.env.DB);
  const gateBot = await new BotsRepo(gateDb).getById(c.get("botId"));
  if (isProTier(gateBot?.tier)) return next();
  const path = c.req.path;
  const hit = PRO_GATE.find(([pre]) => path === pre || path.startsWith(pre + "/"));
  if (hit) return c.html(renderUpgrade(hit[1]));
  return next();
});

// Página de upgrade (item bloqueado del nav apunta aquí).
adminApp.get("/upgrade", (c) => c.html(renderUpgrade()));

// Root → default tab.
adminApp.get("/", (c) => c.redirect("/admin/overview"));

/** "María Contreras" → "MC"; sin nombre, primeras 2 letras del correo. */
function initialsFor(claims: KontroliaTokenClaims): string {
  const name = claims.user_metadata?.full_name?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
  }
  return (claims.email ?? "??").slice(0, 2).toUpperCase();
}

/** "Grupo Ferma" → "GF"; una sola palabra → sus dos primeras letras. */
function orgInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0]! + parts[1][0]!).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase() || "?";
}

// Selector del header (F5): organización + bot activos, y a qué puede
// cambiarse quien entró — solo con sesión de KontrolIA (con Basic Auth no
// hay "quién" del que colgar memberships). Incluye PEER_BOTS por compatibilidad
// con instalaciones que aún usan el switcher viejo entre despliegues.
//
// Trae los bots de TODAS las organizaciones del usuario (no solo la activa):
// el panel de dos columnas del selector cambia de columna derecha al elegir
// una organización SIN otro viaje al servidor — son pocas organizaciones por
// usuario, así que el costo de traerlas todas de una vez es bajo.
adminApp.get("/projects", async (c) => {
  const db = new Db(c.env.DB);
  const botId = c.get("botId");
  const bot = await new BotsRepo(db).getById(botId);
  const base = { current: bot?.name ?? c.env.BOT_NAME ?? "Mi bot", peers: parsePeerBots(c.env) };

  const cfg = kontroliaConfig(c.env);
  const claims = c.get("kontroliaClaims");
  const raw = getCookie(c, SESSION_COOKIE);
  if (!cfg || !claims || !raw) return c.json(base);

  const session = JSON.parse(raw) as KontroliaSession;
  const memberships = await listMemberships(cfg, session.accessToken);
  const orgId = c.get("kontroliaOrgId");
  const botsRepo = new BotsRepo(db);

  // De-dup: KontrolIA a veces trae más de una fila de membership a la misma
  // organización (visto en producción) — sin esto el selector la repetía.
  const orgsById = new Map(memberships.map((m) => [m.organizationId, m]));
  const withBots = await Promise.all(
    Array.from(orgsById.values()).map(async (m) => ({
      m,
      bots: await botsRepo.listByOrganization(m.organizationId),
    })),
  );

  return c.json({
    ...base,
    tenant: {
      user: { initials: initialsFor(claims), label: claims.email ?? claims.user_metadata?.full_name ?? "" },
      organizations: withBots.map(({ m, bots }) => ({
        id: m.organizationId,
        name: m.organization.name,
        initials: orgInitials(m.organization.name),
        current: m.organizationId === orgId,
        bots: bots.map((b) => ({
          id: b.id,
          name: b.name,
          paused: b.paused,
          tier: b.tier,
          current: b.id === botId,
        })),
      })),
      loggedIn: true,
    },
  });
});

// Cambia la organización activa (kontrolia_auth.sessions_context) y refresca
// la sesión para que el JWT traiga el organization_id nuevo — el bot que se
// vea después lo decide setTenantContext() en el próximo request con ese JWT.
adminApp.post("/switch-org", async (c) => {
  const cfg = kontroliaConfig(c.env);
  const claims = c.get("kontroliaClaims");
  const raw = getCookie(c, SESSION_COOKIE);
  if (!cfg || !claims || !raw) return c.text("Sin sesión de KontrolIA Auth.", 400);
  const form = await c.req.formData();
  const organizationId = String(form.get("organization_id") ?? "").trim();
  if (!organizationId) return c.text("Falta organization_id.", 400);

  const session = JSON.parse(raw) as KontroliaSession;
  const ok = await switchActiveOrganization(cfg, session.accessToken, claims.sub, organizationId);
  if (!ok) return c.text("No se pudo cambiar de organización.", 502);

  const refreshed = await refreshSession(cfg, session.refreshToken);
  if (refreshed) {
    setCookie(c, SESSION_COOKIE, JSON.stringify(refreshed), {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  // El bot elegido pertenecía a la organización anterior — no tiene sentido
  // en la nueva. setTenantContext() cae al primer bot de la organización nueva
  // (o al alta si no tiene ninguno — ver NoBotsInOrganizationError arriba).
  deleteCookie(c, BOT_COOKIE);
  // "next" es opcional (el botón "+ Nuevo bot" del selector lo usa para
  // aterrizar directo en /admin/bots/new tras cambiar de organización, en vez
  // de volver a la página de donde vino) — solo se acepta una ruta interna
  // del panel, nunca una URL externa (nada de open-redirect).
  const next = form.get("next");
  const target = typeof next === "string" && next.startsWith("/admin/") ? next : c.req.header("referer");
  return c.redirect(target ?? "/admin/overview", 302);
});

// Cambia el bot activo (cookie nodia_current_bot). Si el selector combinado
// del header también eligió una organización distinta a la activa (el flujo
// "cambié de org Y elegí su bot" en un solo click), primero resuelve ESE
// cambio con el mismo mecanismo que /switch-org — así el selector no tiene
// que mandar dos POSTs ni el usuario ver una recarga intermedia.
adminApp.post("/switch-bot", async (c) => {
  const form = await c.req.formData();
  const botId = String(form.get("bot_id") ?? "").trim();
  const requestedOrgId = String(form.get("organization_id") ?? "").trim();
  let orgId = c.get("kontroliaOrgId");

  if (requestedOrgId && requestedOrgId !== orgId) {
    const cfg = kontroliaConfig(c.env);
    const claims = c.get("kontroliaClaims");
    const raw = getCookie(c, SESSION_COOKIE);
    if (!cfg || !claims || !raw) return c.text("Sin sesión de KontrolIA Auth.", 400);
    const session = JSON.parse(raw) as KontroliaSession;
    const ok = await switchActiveOrganization(cfg, session.accessToken, claims.sub, requestedOrgId);
    if (!ok) return c.text("No se pudo cambiar de organización.", 502);
    const refreshed = await refreshSession(cfg, session.refreshToken);
    if (refreshed) {
      setCookie(c, SESSION_COOKIE, JSON.stringify(refreshed), {
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
        maxAge: 60 * 60 * 24 * 30,
      });
    }
    orgId = requestedOrgId;
  }

  if (!orgId) return c.text("Sin organización activa.", 400);
  const db = new Db(c.env.DB);
  const belongs = await new BotsRepo(db).listByOrganization(orgId);
  if (!belongs.some((b) => b.id === botId)) {
    return c.text("Ese bot no pertenece a la organización elegida.", 400);
  }
  setCookie(c, BOT_COOKIE, botId, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  return c.redirect(c.req.header("referer") ?? "/admin/overview", 302);
});

// Alta del primer bot de una organización (F5): a dónde redirige el guard
// cuando la organización activa no tiene ningún bot. También sirve para
// crear un bot ADICIONAL — el selector del header enlaza aquí con "+ nuevo".
adminApp.get("/bots/new", async (c) => {
  const claims = c.get("kontroliaClaims");
  if (!claims?.organization_id) return c.redirect("/admin/overview", 302);
  return c.html(renderCreateBotPage({ error: c.req.query("err") || undefined }));
});

adminApp.post("/bots", async (c) => {
  const orgId = c.get("kontroliaOrgId") ?? c.get("kontroliaClaims")?.organization_id;
  if (!orgId) return c.text("Sin organización activa.", 400);
  const form = await c.req.formData();
  const name = String(form.get("name") ?? "").trim().slice(0, 100);
  const businessName = String(form.get("business_name") ?? "").trim().slice(0, 100);
  if (!name || !businessName) {
    return c.redirect(`/admin/bots/new?err=${encodeURIComponent("Faltan el nombre del bot y del negocio.")}`, 302);
  }
  const db = new Db(c.env.DB);
  const bot = await new BotsRepo(db).create(orgId, { name, businessName });
  setCookie(c, BOT_COOKIE, bot.id, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  return c.redirect("/admin/overview", 302);
});

// --- Read-only tabs ---------------------------------------------------------

adminApp.get("/overview", async (c) => c.html(await renderOverview(c.env, c.get("botId"))));

adminApp.get("/stats", async (c) => c.html(await renderStats(c.env, c.get("botId"))));

adminApp.get("/costs", async (c) => c.html(await renderCosts(c.env, c.get("botId"), c.req.query("saved") === "1")));

// Monthly AI budget (Costos tab). Empty value clears the cap.
adminApp.post("/costs/budget", async (c) => {
  const form = await c.req.formData();
  const raw = String(form.get("monthly_budget") ?? "").trim();
  const n = Number.parseFloat(raw);
  const value = raw !== "" && Number.isFinite(n) && n > 0 ? String(n) : "";
  await (await settingsFor(c)).set(SETTING_KEYS.monthlyBudget, value);
  return c.redirect("/admin/costs?saved=1");
});

// --- Conocimiento (KB editable, F4) -------------------------------------------

adminApp.get("/kb", async (c) =>
  c.html(
    await renderKbList(c.env, c.get("botId"), {
      saved: c.req.query("saved") === "1",
      deleted: c.req.query("deleted") === "1",
      reindexed: c.req.query("reindexed") ?? undefined,
    }),
  ),
);

adminApp.get("/kb/new", (c) => c.html(renderKbEditor(null, c.env)));

adminApp.get("/kb/:id/edit", async (c) => {
  const db = new Db(c.env.DB);
  const doc = await new KbDocsRepo(db, c.get("botId")).getById(c.req.param("id"));
  if (!doc) return c.redirect("/admin/kb");
  return c.html(renderKbEditor(doc, c.env));
});

// Save = persist in Postgres + index into pgvector immediately (stale vectors for
// the doc are blanket-deleted first), so searchKb uses it on the next message.
adminApp.post("/kb/save", async (c) => {
  const form = await c.req.formData();
  const title = String(form.get("title") ?? "").trim().slice(0, 200);
  const content = String(form.get("content") ?? "").trim().slice(0, MAX_DOC_CHARS);
  if (!title || !content) return c.redirect("/admin/kb");

  const id = String(form.get("id") ?? "").trim() || crypto.randomUUID();
  const db = new Db(c.env.DB);
  const repo = new KbDocsRepo(db, c.get("botId"));
  await repo.upsert({ id, title, content });
  const doc = (await repo.getById(id))!;
  await indexDoc(c.env, doc, c.get("botId"));
  return c.redirect("/admin/kb?saved=1");
});

adminApp.post("/kb/:id/delete", async (c) => {
  const id = c.req.param("id");
  const db = new Db(c.env.DB);
  await new KbDocsRepo(db, c.get("botId")).delete(id);
  await removeDocVectors(c.env, id, c.get("botId"));
  return c.redirect("/admin/kb?deleted=1");
});

// Global reindex: repo fixtures + every dashboard doc.
adminApp.post("/kb/reindex", async (c) => {
  const r = await reindexAll(c.env, c.get("botId"));
  return c.redirect(`/admin/kb?reindexed=${r.indexed}`);
});

// --- Handoff: plantilla HSM del aviso al dueño ---------------------------------

// Setup one-shot: crea la plantilla en la Content API de Twilio, la somete a
// aprobación de WhatsApp (UTILITY) y guarda el ContentSid en settings —
// notifyOwner la usa como fallback del secret, sin pasos manuales.
adminApp.post("/handoff/template/setup", async (c) => {
  const r = await createHandoffTemplate(c.env);
  if ("error" in r) return c.json(r, 502);
  await (await settingsFor(c)).set(SETTING_KEYS.twilioHandoffContentSid, r.sid);
  return c.json(r);
});

// Estado de aprobación de la plantilla del handoff (approved | pending | …).
adminApp.get("/handoff/template/status", async (c) => {
  const sid =
    c.env.TWILIO_HANDOFF_CONTENT_SID ||
    (await (await settingsFor(c)).get(SETTING_KEYS.twilioHandoffContentSid));
  if (!sid) return c.json({ error: "sin plantilla — corre el setup primero" }, 404);
  const r = await contentApprovalStatus(c.env, sid);
  return c.json({ sid, ...r });
});

// --- Mejoras (flywheel, F5) ----------------------------------------------------

adminApp.get("/mejoras", async (c) =>
  c.html(
    await renderMejoras(c.env, c.get("botId"), {
      found: c.req.query("found") ?? undefined,
      applied: c.req.query("applied") === "1",
      dismissed: c.req.query("dismissed") === "1",
    }),
  ),
);

// Run the detectors on demand (they also run nightly from scheduled()).
adminApp.post("/mejoras/run", async (c) => {
  const r = await runFlywheel(c.env, c.get("botId"));
  return c.redirect(`/admin/mejoras?found=${r.created}`);
});

adminApp.post("/mejoras/:id/apply", async (c) => {
  const ok = await applySuggestion(c.env, c.req.param("id"), c.get("botId"));
  return c.redirect(ok ? "/admin/mejoras?applied=1" : "/admin/mejoras");
});

adminApp.post("/mejoras/:id/dismiss", async (c) => {
  const ok = await dismissSuggestion(c.env, c.req.param("id"), c.get("botId"));
  return c.redirect(ok ? "/admin/mejoras?dismissed=1" : "/admin/mejoras");
});

// Autonomía del flywheel: manual (default) o copiloto (auto-aplica lo seguro
// en el cron nocturno — KB sin huecos y lecciones; lo delicado sigue en cola).
adminApp.post("/mejoras/autonomy", async (c) => {
  const form = await c.req.formData();
  const level = String(form.get("level") ?? "manual") === "copilot" ? "copilot" : "manual";
  await (await settingsFor(c)).set(SETTING_KEYS.autonomyLevel, level);
  return c.redirect("/admin/mejoras");
});

// Remove one lesson from the prompt (the ✕ next to each active lesson).
adminApp.post("/mejoras/lessons/remove", async (c) => {
  const form = await c.req.formData();
  const lesson = String(form.get("lesson") ?? "");
  const lessons = (await getLessons(c.env, c.get("botId"))).filter((l) => l !== lesson);
  await saveLessons(c.env, lessons, c.get("botId"));
  return c.redirect("/admin/mejoras");
});

// Inbox (F1): two-pane view. ?c=<id> selects the thread; ?f/?q filter the list.
adminApp.get("/conversations", async (c) =>
  c.html(
    await renderInbox(c.env, c.get("botId"), {
      search: c.req.query("q"),
      filter: c.req.query("f"),
      selectedId: c.req.query("c"),
    }),
  ),
);

// HTMX fragments (polled): left list every 10s, thread every 5s. Registered
// before /conversations/:id so the static segments win the match.
adminApp.get("/conversations/list-fragment", async (c) =>
  c.html(
    await renderInboxList(c.env, c.get("botId"), {
      search: c.req.query("q"),
      filter: c.req.query("f"),
      selectedId: c.req.query("c"),
    }),
  ),
);

adminApp.get("/conversations/thread/:id", async (c) =>
  c.html(await renderThreadLive(c.env, c.get("botId"), c.req.param("id"))),
);

// Old detail URLs (linked from Insights, notifications, etc.) → inbox selection.
adminApp.get("/conversations/:id", (c) =>
  c.redirect(`/admin/conversations?c=${encodeURIComponent(c.req.param("id"))}`),
);

// Insights tab. Visiting it opportunistically grades a few pending
// conversations in the background (waitUntil) so the tab catches up on its own
// even without pressing "Analizar ahora". TODO: move the main run to
// scheduled() in index.ts once the channels/meta work in flight there lands.
adminApp.get("/insights", async (c) => {
  const botId = c.get("botId");
  try {
    c.executionCtx.waitUntil(
      analyzeConversations(c.env, { limit: 3, botId }).catch((e) =>
        console.error("[insights] background analysis failed:", e),
      ),
    );
  } catch {
    // no executionCtx (tests) — render without background catch-up
  }
  return c.html(await renderInsights(c.env, botId, c.req.query("analyzed") ?? undefined));
});

// "Analizar ahora": grade up to 10 pending conversations inline, then redirect
// back with the count for the confirmation banner.
adminApp.post("/insights/analyze", async (c) => {
  const result = await analyzeConversations(c.env, { limit: 10, botId: c.get("botId") });
  return c.redirect(`/admin/insights?analyzed=${result.analyzed}`);
});

// "Mi Agente": n8n-style canvas of how the bot works. The canvas fragment is
// polled by HTMX every 15s (live activity pulse); node panels load on click.
adminApp.get("/agente", async (c) => c.html(await renderAgentePage(c.env, c.get("botId"))));

adminApp.get("/agente/canvas", async (c) => c.html(await renderAgenteCanvas(c.env, c.get("botId"))));

adminApp.get("/agente/node/:id", async (c) =>
  c.html(await renderNodeModal(c.env, c.get("botId"), c.req.param("id"))),
);

// Save a node's config from its modal. Writes the relevant settings (with
// clamps), re-renders the modal with a saved banner + toast, and fires the
// `canvas-refresh` event so the diagram updates immediately.
adminApp.post("/agente/node/:id/save", async (c) => {
  const id = c.req.param("id");
  const form = await c.req.formData();
  const repo = await settingsFor(c);

  const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
  const num = (key: string): number | null => {
    const raw = form.get(key);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  if (id === "buffer") {
    const s = num("buffer_seconds");
    if (s !== null) await repo.set(SETTING_KEYS.bufferSeconds, String(Math.round(clamp(s, 1, 60))));
  } else if (id === "reply") {
    const chunks = num("max_chunks");
    if (chunks !== null) await repo.set(SETTING_KEYS.maxChunks, String(Math.round(clamp(chunks, 1, 5))));
    const delayS = num("inter_chunk_delay_s");
    if (delayS !== null)
      await repo.set(SETTING_KEYS.interChunkDelayMs, String(Math.round(clamp(delayS, 0, 5) * 1000)));
  } else if (id === "model") {
    const m = String(form.get("model_override") ?? "");
    if (m === "auto" || m === "haiku" || m === "sonnet") await repo.set(SETTING_KEYS.modelOverride, m);
    const t = num("temperature");
    if (t !== null) await repo.set(SETTING_KEYS.temperature, String(clamp(t, 0, 1)));
  } else if (id === "brain") {
    // Three sub-actions share the brain modal: reset-to-auto, pause toggle,
    // and saving the manual prompt. Checked in that priority order.
    if (String(form.get("action") ?? "") === "reset") {
      await repo.set(SETTING_KEYS.systemPromptOverride, "");
    } else if (form.get("bot_paused") !== null) {
      await repo.set(SETTING_KEYS.botPaused, String(form.get("bot_paused")) === "1" ? "1" : "0");
    } else if (form.get("system_prompt_override") !== null) {
      await repo.set(SETTING_KEYS.systemPromptOverride, String(form.get("system_prompt_override")).trim());
    }
  } else {
    return c.text("Nodo desconocido", 404);
  }

  c.header("HX-Trigger", "canvas-refresh");
  return c.html((await renderNodeModal(c.env, c.get("botId"), id, true)) + toastOob("✓ Guardado"));
});

// Toggle a tool on/off (settings.disabled_tools). Returns the refreshed modal;
// the canvas badge updates via the canvas-refresh event.
adminApp.post("/agente/tools/:name/toggle", async (c) => {
  const name = c.req.param("name");
  const ok = await toggleTool(c.env, c.get("botId"), name);
  if (!ok) return c.text("Tool no encontrada", 404);
  c.header("HX-Trigger", "canvas-refresh");
  return c.html((await renderNodeModal(c.env, c.get("botId"), `tool:${name}`, true)) + toastOob("✓ Guardado"));
});

adminApp.get("/leads", async (c) => c.html(await renderLeads(c.env, c.get("botId"))));

adminApp.get("/tickets", async (c) => c.html(await renderTickets(c.env, c.get("botId"))));

// Conexiones: mapa de canales con estado verde/gris (paso 4 del onboarding).
adminApp.get("/conexiones", async (c) => c.html(await renderConexiones(c.env, c.get("botId"))));

// Diálogo de conexión: instrucciones + formulario para pegar el token, sin
// terminal (F5/F4: cada bot conecta sus propios canales desde el panel).
adminApp.get("/conexiones/:channel/connect", (c) => {
  const channel = c.req.param("channel");
  if (channel !== "telegram" && channel !== "twilio" && channel !== "manychat") {
    return c.text("Canal desconocido", 404);
  }
  return c.html(renderConnectModal(channel));
});

adminApp.post("/conexiones/:channel/connect", async (c) => {
  const channel = c.req.param("channel");
  if (channel !== "telegram" && channel !== "twilio" && channel !== "manychat") {
    return c.text("Canal desconocido", 404);
  }
  const form = await c.req.formData();
  const modalHtml = await connectChannel(c.env, c.get("botId"), channel, form);
  // El modal de éxito viaja junto con un refresh OOB de la grilla de tarjetas
  // de atrás — así se ve verde de inmediato, sin recargar la página.
  const gridHtml = await renderConexionesGrid(c.env, c.get("botId"));
  return c.html(modalHtml + gridHtml);
});

adminApp.post("/conexiones/:channel/disconnect", async (c) => {
  const channel = c.req.param("channel");
  if (channel !== "telegram" && channel !== "twilio" && channel !== "manychat") {
    return c.text("Canal desconocido", 404);
  }
  await disconnectChannel(c.env, c.get("botId"), channel);
  return c.redirect("/admin/conexiones", 302);
});

adminApp.get("/campanas", async (c) => {
  const q: Record<string, string | undefined> = {
    ok: c.req.query("ok"),
    err: c.req.query("err"),
    ff: c.req.query("ff"),
    tp: c.req.query("tp"),
    dup: c.req.query("dup"),
    quota: c.req.query("quota"),
    fail: c.req.query("fail"),
  };
  return c.html(await renderCampanas(c.env, c.get("botId"), q));
});

adminApp.post("/campanas/send", async (c) => {
  const form = await c.req.formData();
  const segmentId = String(form.get("segment") ?? "");
  const campaignKey = String(form.get("campaign_key") ?? "").trim();
  const freeformText = String(form.get("freeform_text") ?? "").trim();
  const templateSid = String(form.get("template_sid") ?? "").trim();
  const varsRaw = String(form.get("template_vars") ?? "").trim();
  if (!segmentId || !campaignKey || (!freeformText && !templateSid)) {
    return c.redirect("/admin/campanas?err=" + encodeURIComponent("Falta el segmento, el nombre de campaña, o un mensaje/plantilla."));
  }
  let variables: Record<string, string> | undefined;
  if (varsRaw) {
    try {
      variables = JSON.parse(varsRaw);
    } catch {
      return c.redirect("/admin/campanas?err=" + encodeURIComponent("Las variables no son JSON válido."));
    }
  }
  // El body de la plantilla viaja al historial de cada conversación — sin él,
  // el agente no sabría qué se le preguntó al cliente cuando responda.
  let templateBody: string | undefined;
  if (templateSid) {
    const { listContentTemplates } = await import("../campaigns");
    const tpl = (await listContentTemplates(c.env).catch(() => [])).find((t) => t.sid === templateSid);
    templateBody = tpl?.body || undefined;
  }
  const result = await sendCampaign(c.env, {
    segmentId,
    campaignKey,
    freeformText: freeformText || undefined,
    template: templateSid ? { sid: templateSid, variables, body: templateBody } : undefined,
    botId: c.get("botId"),
  });
  const q = new URLSearchParams({
    ok: "1",
    ff: String(result.sentFreeform),
    tp: String(result.sentTemplate),
    dup: String(result.skippedDuplicate),
    quota: String(result.skippedQuota),
    fail: String(result.failed),
  });
  return c.redirect("/admin/campanas?" + q.toString());
});

adminApp.get("/config", async (c) => {
  const configDb = new Db(c.env.DB);
  const configBotId = c.get("botId");
  const settings = await new SettingsRepo(configDb, configBotId).all();
  const bot = await new BotsRepo(configDb).getById(configBotId);
  const saved = c.req.query("saved") === "1";
  return c.html(
    renderConfig(
      settings,
      bot?.config ?? {},
      { name: bot?.name ?? c.env.BOT_NAME, businessName: bot?.business_name ?? c.env.BUSINESS_NAME },
      saved,
      c.req.query("llmtest"),
    ),
  );
});

// Prueba de la config BYO-LLM guardada: un generateText mínimo con el modelo
// resuelto (settings > env). Redirige de vuelta con el resultado en la query.
adminApp.get("/config/llm-test", async (c) => {
  try {
    const ov = await loadLlmOverrides(c.env, c.get("botId"));
    const { model, modelId, provider } = createModel(c.env, "fast", ov);
    const r = await generateText({
      model,
      prompt: "Responde únicamente: ok",
      maxOutputTokens: 8,
    });
    const okText = r.text.trim().slice(0, 20) || "ok";
    return c.redirect(
      `/admin/config?llmtest=${encodeURIComponent(`ok:${provider}/${modelId} → "${okText}"`)}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.redirect(`/admin/config?llmtest=${encodeURIComponent(`err:${msg.slice(0, 180)}`)}`);
  }
});

// Save the control panel. Card selections are mapped from the picked option
// (value or label) back to the value we persist via `levelToValue`; free-text
// fields are stored verbatim (trimmed). Empty/absent => default at load time.
adminApp.post("/config", async (c) => {
  const form = await c.req.formData();
  const repo = await settingsFor(c);

  // Card-based controls: tone, buffer_seconds, max_chunks, model_override, bot_paused.
  for (const key of Object.keys(CONTROLS)) {
    const picked = form.get(key);
    if (picked === null) continue; // control not submitted — leave as-is
    const value = levelToValue(key, String(picked));
    if (value !== null) await repo.set(key, value);
  }

  // Free-text controls (stored verbatim, trimmed).
  const textKeys: SettingKey[] = [
    SETTING_KEYS.botName,
    SETTING_KEYS.businessContext,
    SETTING_KEYS.systemPromptOverride,
    SETTING_KEYS.escalationKeywords,
  ];
  for (const key of textKeys) {
    const raw = form.get(key);
    if (raw === null) continue;
    await repo.set(key, String(raw).trim());
  }

  // BYO-LLM: proveedor y modelo se guardan tal cual (allow-list de valores).
  const provRaw = form.get(SETTING_KEYS.llmProvider);
  if (provRaw !== null) {
    const v = String(provRaw).trim().toLowerCase();
    await repo.set(
      SETTING_KEYS.llmProvider,
      v === "anthropic" || v === "openai" || v === "xai" ? v : "",
    );
  }
  const modelRaw = form.get(SETTING_KEYS.llmModel);
  if (modelRaw !== null) {
    await repo.set(SETTING_KEYS.llmModel, String(modelRaw).trim().slice(0, 100));
  }
  // La API key SOLO se sobreescribe si escribieron algo (el input siempre
  // llega vacío cuando no la tocaron); el checkbox la borra explícitamente.
  if (form.get("llm_api_key_clear") === "1") {
    await repo.set(SETTING_KEYS.llmApiKey, "");
  } else {
    const keyRaw = form.get(SETTING_KEYS.llmApiKey);
    if (keyRaw !== null && String(keyRaw).trim() !== "") {
      await repo.set(SETTING_KEYS.llmApiKey, String(keyRaw).trim());
    }
  }

  return c.redirect("/admin/config?saved=1");
});

// --- CSV export -------------------------------------------------------------

adminApp.get("/leads/export.csv", async (c) => {
  const csv = await exportLeadsCsv(c.env, c.get("botId"));
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${Date.now()}.csv"`,
    },
  });
});

// --- Mutating actions (HTMX / plain form posts) -----------------------------

const LEAD_STATUSES: ReadonlyArray<Lead["status"]> = ["new", "contacted", "sold", "lost"];

// Mark a lead's status (nuevo / contactado / vendido / perdido).
adminApp.post("/leads/:id/status", async (c) => {
  const form = await c.req.formData();
  const raw = String(form.get("status") ?? "new");
  const status: Lead["status"] = (LEAD_STATUSES as readonly string[]).includes(raw)
    ? (raw as Lead["status"])
    : "new";
  const db = new Db(c.env.DB);
  const leads = new LeadsRepo(db, c.get("botId"));
  await leads.setStatus(c.req.param("id"), status);
  return c.redirect("/admin/leads");
});

// Resolve a support ticket.
adminApp.post("/tickets/:id/resolve", async (c) => {
  const form = await c.req.formData();
  const resolvedBy = String(form.get("resolved_by") ?? c.env.OWNER_EMAIL ?? "admin").trim() || "admin";
  const db = new Db(c.env.DB);
  const tickets = new TicketsRepo(db, c.get("botId"));
  await tickets.resolve(c.req.param("id"), resolvedBy);
  return c.redirect("/admin/tickets");
});

// --- Inbox actions (F1) -------------------------------------------------------

/** Owner takes over for this long after replying/pausing from the dashboard. */
const TAKEOVER_MS = 60 * 60 * 1000;

// Reply AS A HUMAN from the dashboard: sends through the conversation's channel
// adapter (Twilio/Telegram/Meta/ManyChat), persists the message as role=owner,
// and pauses the bot (owner takeover — same behavior as isOwnerMessage in the
// agent). Returns a status line for #send-status plus an out-of-band swap that
// refreshes #thread-live instantly. X-Sent: 1 tells the composer to reset.
adminApp.post("/conversations/:id/reply", async (c) => {
  const id = c.req.param("id");
  const form = await c.req.formData().catch(() => null);
  const text = String(form?.get("text") ?? "").trim();
  if (!text) return c.html(`<span class="text-stone-400">Escribe un mensaje primero.</span>`);

  const db = new Db(c.env.DB);
  // Transicional (F2.1): el panel todavía no tiene sesión de KontrolIA Auth
  // con bot resuelto (eso llega en F5) — hasta entonces sigue siendo un solo
  // bot por despliegue.
  const botId = c.get("botId");
  const convs = new ConversationsRepo(db, botId);
  const conv = await convs.getById(id);
  if (!conv) return c.html(`<span class="text-red-600">✗ Conversación no encontrada.</span>`);

  try {
    const adapter = pickAdapter(conv.channel as ChannelId);
    await adapter.sendReply(
      {
        channel: conv.channel as ChannelId,
        channelUserId: conv.channel_user_id,
        chunks: [text],
        interChunkDelayMs: 0,
      },
      c.env,
    );
  } catch (e) {
    // Nothing persisted on failure: the customer never got the message.
    const msg = e instanceof Error ? e.message : String(e);
    return c.html(`<span class="text-red-600">✗ No se pudo enviar: ${escapeHtml(msg)}</span>`);
  }

  const msgs = new MessagesRepo(db, botId);
  await msgs.append(id, "owner", text);
  await convs.touchLastMessage(id);
  await convs.setPausedUntil(id, Date.now() + TAKEOVER_MS);

  c.header("X-Sent", "1");
  return c.html(
    `<span class="text-emerald-600">✓ Enviado por ${escapeHtml(channelLabel(conv.channel))}</span>` +
      `<div id="thread-live" hx-swap-oob="innerHTML">${await renderThreadLive(c.env, c.get("botId"), id)}</div>`,
  );
});

// Pause the bot in this conversation without sending anything (owner wants the
// customer for themselves). Returns the refreshed thread fragment.
adminApp.post("/conversations/:id/pause", async (c) => {
  const id = c.req.param("id");
  const db = new Db(c.env.DB);
  const convs = new ConversationsRepo(db, c.get("botId"));
  await convs.setPausedUntil(id, Date.now() + TAKEOVER_MS);
  return c.html(await renderThreadLive(c.env, c.get("botId"), id));
});

// Return a paused conversation back to the bot. Clears paused_until AND appends
// an owner-authored summary of the human handoff to the message history, so the
// bot resumes with context about what the owner already resolved.
adminApp.post("/conversations/:id/resume", async (c) => {
  const id = c.req.param("id");
  const db = new Db(c.env.DB);
  const botId = c.get("botId");
  const convs = new ConversationsRepo(db, botId);
  await convs.setPausedUntil(id, null);
  // Insert a system-style owner note summarizing the human handoff so the bot
  // has context when it picks the conversation back up. The summary field is
  // optional, so tolerate a request with no form body (formData() throws on an
  // empty/no-content-type body).
  const form = await c.req.formData().catch(() => null);
  const summary =
    String(form?.get("summary") ?? "").trim() ||
    "(El dueño habló con el cliente y resolvió la consulta.)";
  const msgs = new MessagesRepo(db, botId);
  await msgs.append(id, "owner", summary);
  return c.redirect(`/admin/conversations?c=${encodeURIComponent(id)}`);
});

// --- Co-pilot (HTMX-driven suggestion) --------------------------------------

/** Escape untrusted text (LLM output) before interpolating into an HTML fragment. */
function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

// "Suggest Reply": call Anthropic with the recent conversation history + the
// business context and return ONE short message the owner can copy/paste (or
// send manually via WhatsApp). It does NOT send anything to the customer — it
// only returns an HTML fragment for HTMX to swap into the suggestion area.
//
// Auth: already enforced by the wildcard Basic Auth middleware above, so there
// is no per-route auth check here (no magic-link `requireAuth`).
adminApp.post("/conversations/:id/suggest", async (c) => {
  const suggestDb = new Db(c.env.DB);
  const suggestBotId = c.get("botId");
  const msgs = new MessagesRepo(suggestDb, suggestBotId);
  const history = await msgs.lastN(c.req.param("id"), 20);
  const { model } = createModel(c.env, "fast", await loadLlmOverrides(c.env, suggestBotId));
  const aiMessages = history.map((m) => ({
    role: (m.role === "tool" ? "user" : m.role === "owner" ? "assistant" : m.role) as
      | "user"
      | "assistant",
    content: m.content,
  }));
  aiMessages.push({
    role: "user",
    content:
      "Eres asistente del dueño. Sugiere UN solo mensaje corto en español que el dueño podría enviar al cliente para resolver la última consulta. NO incluyas preámbulo, solo la frase a copy/paste.",
  });
  const suggestBot = await new BotsRepo(suggestDb).getById(suggestBotId);
  const sys = systemPromptFromEnv(
    {
      name: suggestBot?.name ?? c.env.BOT_NAME,
      businessName: suggestBot?.business_name ?? c.env.BUSINESS_NAME,
      language: suggestBot?.language ?? c.env.BOT_LANGUAGE,
    },
    [],
    renderBusinessContext(suggestBot?.config ?? {}),
  );
  const result = await generateText({
    model,
    system: sys,
    messages: aiMessages,
  });
  // HTMX swaps this into #suggestion-box; the "Usar" button fills the composer.
  return c.html(renderSuggestionBox(result.text));
});

// --- Fallback ---------------------------------------------------------------

adminApp.notFound((c) =>
  c.html(
    layout({
      title: "No encontrado",
      activeTab: "overview",
      body: "<p class='text-stone-500'>Página no encontrada.</p>",
    }),
    404,
  ),
);
