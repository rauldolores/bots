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
import { generateText, generateObject } from "ai";
import { z } from "zod";
import { createModel } from "../llm/provider";
import { loadLlmOverrides } from "../settings-loader";
import type { Env } from "../env";
import { adminAuth } from "./auth";
import { layout, renderUpgrade, renderAccessDenied } from "./views/layout";
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
import {
  renderHabilidades,
  renderSkillForm,
  renderSkillTemplatesModal,
  parseOutputFields,
  validateFields,
} from "./views/habilidades";
import { BotSkillsRepo, slugify } from "../db/skills";
import { SKILL_TEMPLATES } from "../skills/templates";
import { BotApiKeysRepo } from "../db/apiKeys";
import { renderSeguimientos, renderSequenceForm, renderNurtureTemplatesModal, parseSteps } from "./views/seguimientos";
import { NurtureSequencesRepo } from "../db/nurtureSequences";
import { NURTURE_TEMPLATES } from "../nurture/templates";
import { enrollLeadInSequence, stopSequenceForLead } from "../nurture/run";
import { KbDocsRepo, indexDoc, removeDocVectors, reindexAll, MAX_DOC_CHARS } from "../kb/docs";
import { CrmProposalsRepo } from "../db/crmProposals";
import { ejecutarPropuesta } from "../crm/ejecutar";
import { renderMejoras } from "./views/mejoras";
import { runFlywheel, getLessons, saveLessons } from "../flywheel/detect";
import { applySuggestion, dismissSuggestion } from "../flywheel/apply";
import { renderLeads, exportLeadsCsv } from "./views/leads";
import { renderTickets, updateTicketPriority } from "./views/tickets";
import { renderCalendario, cancelAppointment } from "./views/calendario";
import { renderTelefono } from "./views/telefono";
import { startOnboarding, activateOnboarding, disableOnboarding, retryOnboarding } from "../channels/voice/onboarding/service";
import { renderConfig } from "./views/config";
import {
  renderConexiones,
  renderConnectModal,
  renderConexionesGrid,
  connectChannel,
  disconnectChannel,
  renderConnectorConnectModal,
  renderConnectorsGrid,
  connectConnector,
  disconnectConnector,
  categoryOfProvider,
  renderMcpConnectModal,
  connectMcp,
  renderMcpToolsModal,
  renderMcpEditModal,
  saveMcpPurpose,
  updateConnectorConfig,
  saveWidgetConfig,
  renderPipelineStageModal,
  savePipelineStage,
  renderEmailConnectModal,
  connectEmailChannel,
  disconnectEmailChannel,
} from "./views/conexiones";
import { startOAuth, handleOAuthCallback } from "./oauthConnect";
import { startMcpOAuth, handleMcpOAuthCallback } from "./mcpOAuthConnect";
import type { ConnectorCategory } from "../connectors/registry";
import { renderCampanas, renderLivePreview } from "./views/campanas";
import { enqueueCampaign, createHandoffTemplate, contentApprovalStatus, listContentTemplates } from "../campaigns";
import { segmentCount, parseCampaignFilters } from "../segments";
import { resolveTimezone } from "../datetime";
import { Db } from "../db/client";
import { BotChannelsRepo } from "../db/botChannels";
import { LeadsRepo, type Lead } from "../db/leads";
import { TicketsRepo } from "../db/tickets";
import { pushToTicketsIfConnected } from "../tools/handoffHuman";
import { ConversationsRepo } from "../db/conversations";
import { BotsRepo, type BotConfig, type BotCatalogItem } from "../db/bots";
import { BotConnectorsRepo } from "../db/botConnectors";
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
import {
  resolveAdminTenant,
  setBotCookie,
  BOT_COOKIE,
  NoBotsInOrganizationError,
  type AdminBindings,
} from "./tenantContext";
import { PERMISSION_GATE, hasAnyAppAccess, hasPermission, requirePermission, visibleNavIds } from "./permissions";
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
// /access-denied también va aquí: es el destino del guard de acceso de la
// Sección 3 de abajo — si no se eximiera de setTenantContext, alguien en una
// organización sin bots (o sin acceso a ninguno) rebotaría a /bots/new antes
// de que este guard alcance a redirigirlo a /access-denied, o directamente
// no podría renderizar la página que le explica por qué no tiene acceso.
const TENANT_EXEMPT_SUFFIXES = ["/switch-org", "/switch-bot", "/bots/new", "/bots", "/access-denied"];
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
    // Sesión válida en KontrolIA no es lo mismo que tener acceso a Nodia
    // Agents — una cuenta puede estar autenticada en el ecosistema pero
    // nunca haber sido asignada a ningún rol de esta app en su organización
    // activa (claims.permissions sin ningún "nodia-agents.*"). Sin esto,
    // cualquier cuenta de KontrolIA podía navegar el panel completo. Mismo
    // principio que ya usa Faqturia (hasFaqturiaAccess en su middleware).
    if (!hasAnyAppAccess(result.claims)) {
      return c.redirect("/admin/access-denied", 302);
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

// Gate de permisos de KontrolIA Auth (ver admin/permissions.ts): mismo
// idioma que PRO_GATE de arriba — prefijo de URL → permiso requerido. Solo
// corre para sesiones de KontrolIA (Basic Auth / DASHBOARD_PUBLIC no tienen
// kontroliaClaims, así que pasan sin cambio); un platform admin nunca se
// bloquea.
adminApp.use("*", async (c, next) => {
  if (isAuthExempt(c.req.path) || isTenantExempt(c.req.path)) return next();
  const claims = c.get("kontroliaClaims");
  if (!claims || claims.is_platform_admin) return next();
  // c.req.path trae "/admin" puesto en producción (montado bajo la app
  // principal) pero NO cuando se prueba adminApp.fetch() directo — se
  // recorta aquí para que PERMISSION_GATE (definido sin ese prefijo, ver
  // admin/permissions.ts) compare lo mismo en los dos casos.
  const path = c.req.path.replace(/^\/admin(?=\/|$)/, "") || "/";
  const hit = PERMISSION_GATE.find(([pre]) => path === pre || path.startsWith(pre + "/"));
  if (hit && !hasPermission(claims, hit[1])) return c.html(renderAccessDenied(hit[2], visibleNavIds(claims)));
  return next();
});

// Página de upgrade (item bloqueado del nav apunta aquí).
adminApp.get("/upgrade", (c) => c.html(renderUpgrade()));

// Destino del guard de acceso base (Sección 3) y del gate de permisos de
// arriba — se llega aquí ya AUTENTICADO pero sin el permiso necesario.
adminApp.get("/access-denied", (c) => {
  const claims = c.get("kontroliaClaims");
  return c.html(renderAccessDenied(undefined, visibleNavIds(claims)));
});

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
  const botsRepoLocal = new BotsRepo(db);
  const bot = await botsRepoLocal.getById(botId);
  const base = { current: bot?.name ?? c.env.BOT_NAME ?? "Mi bot", peers: parsePeerBots(c.env) };

  const cfg = kontroliaConfig(c.env);
  const claims = c.get("kontroliaClaims");
  const raw = getCookie(c, SESSION_COOKIE);
  if (!cfg || !claims || !raw) {
    // Sin sesión de KontrolIA el selector de organizaciones no aplica, pero el
    // despliegue sí puede tener varios bots — el header necesita saberlo para
    // ofrecer el cambio en vez de dejar al dueño viendo uno sin decírselo.
    const locales = await botsRepoLocal.listAll();
    return c.json({
      ...base,
      localBots:
        locales.length > 1
          ? locales.map((b) => ({ id: b.id, name: b.name, current: b.id === botId }))
          : [],
    });
  }

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

  // Basic Auth: no hay organización que validar (quien entró tiene la
  // contraseña del despliegue y ya ve todos los bots). Solo se comprueba que
  // el bot exista, para no dejar la cookie apuntando a un id inventado.
  if (!orgId && !requestedOrgId) {
    const db = new Db(c.env.DB);
    const existe = await new BotsRepo(db).getById(botId);
    if (!existe) return c.text("Ese bot no existe.", 400);
    setBotCookie(c, botId);
    return c.redirect(c.req.header("referer") ?? "/admin/overview", 302);
  }

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

adminApp.get("/overview", async (c) => c.html(await renderOverview(c.env, c.get("botId"), visibleNavIds(c.get("kontroliaClaims")))));

adminApp.get("/stats", async (c) => c.html(await renderStats(c.env, c.get("botId"), visibleNavIds(c.get("kontroliaClaims")))));

adminApp.get("/costs", async (c) =>
  c.html(await renderCosts(c.env, c.get("botId"), c.req.query("saved") === "1", visibleNavIds(c.get("kontroliaClaims")))),
);

// Monthly AI budget (Costos tab). Empty value clears the cap.
adminApp.post("/costs/budget", async (c) => {
  const form = await c.req.formData();
  const raw = String(form.get("monthly_budget") ?? "").trim();
  const n = Number.parseFloat(raw);
  const value = raw !== "" && Number.isFinite(n) && n > 0 ? String(n) : "";
  await (await settingsFor(c)).set(SETTING_KEYS.monthlyBudget, value);
  return c.redirect("/admin/costs?saved=1");
});

// --- Habilidades (F8: el agente como servicio) --------------------------------

adminApp.get("/habilidades", async (c) =>
  c.html(
    await renderHabilidades(c.env, c.get("botId"), {
      newKey: c.req.query("key") ?? undefined,
      error: c.req.query("err") ?? undefined,
    }),
  ),
);

adminApp.get("/habilidades/nueva", async (c) =>
  c.html(await renderSkillForm(c.env, c.get("botId"), null)),
);

// Plantillas — van ANTES de /habilidades/:id* (mismo motivo que /habilidades/llaves
// más abajo: si no, el segmento dinámico se traga "plantillas").
adminApp.get("/habilidades/plantillas", (c) => c.html(renderSkillTemplatesModal()));

adminApp.post("/habilidades/plantillas/:slug/usar", async (c) => {
  const botId = c.get("botId");
  const template = SKILL_TEMPLATES.find((t) => t.slug === c.req.param("slug"));
  if (!template) return c.text("Plantilla no encontrada.", 404);
  const repo = new BotSkillsRepo(new Db(c.env.DB), botId);
  const slug = await repo.uniqueSlug(slugify(template.name));
  const id = await repo.create({
    slug,
    name: template.name,
    instructions: template.instructions,
    outputFields: template.outputFields,
  });
  return c.redirect(`/admin/habilidades/${id}/editar`, 302);
});

adminApp.get("/habilidades/:id/editar", async (c) =>
  c.html(await renderSkillForm(c.env, c.get("botId"), c.req.param("id"))),
);

adminApp.post("/habilidades/nueva", async (c) => {
  const botId = c.get("botId");
  const form = await c.req.formData();
  const name = String(form.get("name") ?? "").trim();
  const instructions = String(form.get("instructions") ?? "").trim();
  const fields = parseOutputFields(form);

  const invalid = validateFields(fields);
  if (!name || !instructions || invalid) {
    return c.html(
      await renderSkillForm(c.env, botId, null, invalid ?? "Falta el nombre o las instrucciones."),
    );
  }

  const repo = new BotSkillsRepo(new Db(c.env.DB), botId);
  const slug = await repo.uniqueSlug(slugify(name));
  await repo.create({ slug, name, instructions, outputFields: fields });
  return c.redirect("/admin/habilidades", 302);
});

// Las rutas de llaves van ANTES de /habilidades/:id — si no, el segmento
// dinámico se traga "llaves" y el POST termina intentando editar una
// habilidad con ese id (mismo detalle que ya cuidan las rutas de /conversations).
//
// La llave se muestra UNA vez, en el redirect — nunca se vuelve a poder leer.
adminApp.post("/habilidades/llaves", async (c) => {
  const form = await c.req.formData();
  const name = String(form.get("name") ?? "").trim() || "Sin nombre";
  const { plaintext } = await new BotApiKeysRepo(new Db(c.env.DB)).create(c.get("botId"), name);
  return c.redirect(`/admin/habilidades?key=${encodeURIComponent(plaintext)}`, 302);
});

adminApp.post("/habilidades/llaves/:id/revocar", async (c) => {
  await new BotApiKeysRepo(new Db(c.env.DB)).setEnabled(c.req.param("id"), c.get("botId"), false);
  return c.redirect("/admin/habilidades", 302);
});

adminApp.post("/habilidades/:id", async (c) => {
  const botId = c.get("botId");
  const id = c.req.param("id");
  const form = await c.req.formData();
  const name = String(form.get("name") ?? "").trim();
  const instructions = String(form.get("instructions") ?? "").trim();
  const fields = parseOutputFields(form);

  const invalid = validateFields(fields);
  if (!name || !instructions || invalid) {
    return c.html(
      await renderSkillForm(c.env, botId, id, invalid ?? "Falta el nombre o las instrucciones."),
    );
  }

  await new BotSkillsRepo(new Db(c.env.DB), botId).update(id, {
    name,
    instructions,
    outputFields: fields,
    // Bug real: el checkbox manda un <input type="hidden" name="enabled"
    // value="0"> ANTES que el checkbox mismo (para que "sin marcar" tenga un
    // valor que mandar) — con `form.get()`, que devuelve el PRIMER valor
    // repetido, eso significa que "activar" nunca se detectaba: siempre
    // ganaba el "0" del hidden, estuviera marcado o no. `getAll()` +
    // `includes("1")` no depende del orden — mismo patrón ya correcto en
    // segments.ts para exclude_busy.
    enabled: form.getAll("enabled").includes("1"),
  });
  return c.redirect("/admin/habilidades", 302);
});

adminApp.post("/habilidades/:id/borrar", async (c) => {
  await new BotSkillsRepo(new Db(c.env.DB), c.get("botId")).remove(c.req.param("id"));
  return c.redirect("/admin/habilidades", 302);
});

// --- Seguimientos (F8 fase C: perseguir la venta durante días) ---------------

adminApp.get("/seguimientos", async (c) =>
  c.html(await renderSeguimientos(c.env, c.get("botId"), { error: c.req.query("err") ?? undefined })),
);

adminApp.get("/seguimientos/nueva", async (c) =>
  c.html(await renderSequenceForm(c.env, c.get("botId"), null)),
);

// Plantillas — van ANTES de /seguimientos/:id* (mismo motivo que las rutas de
// llaves en /habilidades: si no, el segmento dinámico se traga "plantillas").
adminApp.get("/seguimientos/plantillas", (c) => c.html(renderNurtureTemplatesModal()));

adminApp.post("/seguimientos/plantillas/:slug/usar", async (c) => {
  const botId = c.get("botId");
  const template = NURTURE_TEMPLATES.find((t) => t.slug === c.req.param("slug"));
  if (!template) return c.text("Plantilla no encontrada.", 404);
  const id = await new NurtureSequencesRepo(new Db(c.env.DB), botId).create({
    name: template.name,
    goal: template.goal,
    steps: template.steps,
  });
  return c.redirect(`/admin/seguimientos/${id}/editar`, 302);
});

adminApp.get("/seguimientos/:id/editar", async (c) =>
  c.html(await renderSequenceForm(c.env, c.get("botId"), c.req.param("id"))),
);

adminApp.post("/seguimientos/nueva", async (c) => {
  const botId = c.get("botId");
  const form = await c.req.formData();
  const name = String(form.get("name") ?? "").trim();
  const goal = String(form.get("goal") ?? "").trim();
  const steps = parseSteps(form);

  if (!name || !goal || steps.length === 0) {
    return c.html(
      await renderSequenceForm(c.env, botId, null, "Falta el nombre, el objetivo, o al menos un paso."),
    );
  }
  await new NurtureSequencesRepo(new Db(c.env.DB), botId).create({
    name, goal, steps,
    autoEnroll: form.getAll("auto_enroll").includes("1"),
    stopOnConversion: form.getAll("stop_on_conversion").includes("1"),
  });
  return c.redirect("/admin/seguimientos", 302);
});

adminApp.post("/seguimientos/:id", async (c) => {
  const botId = c.get("botId");
  const id = c.req.param("id");
  const form = await c.req.formData();
  const name = String(form.get("name") ?? "").trim();
  const goal = String(form.get("goal") ?? "").trim();
  const steps = parseSteps(form);

  if (!name || !goal || steps.length === 0) {
    return c.html(
      await renderSequenceForm(c.env, botId, id, "Falta el nombre, el objetivo, o al menos un paso."),
    );
  }
  await new NurtureSequencesRepo(new Db(c.env.DB), botId).update(id, {
    name,
    goal,
    steps,
    // Bug real: "activar" nunca se guardaba — ver el comentario igual en el
    // handler de /habilidades/:id, mismo patrón exacto y misma causa.
    enabled: form.getAll("enabled").includes("1"),
    autoEnroll: form.getAll("auto_enroll").includes("1"),
    stopOnConversion: form.getAll("stop_on_conversion").includes("1"),
  });
  return c.redirect("/admin/seguimientos", 302);
});

adminApp.post("/seguimientos/:id/borrar", async (c) => {
  await new NurtureSequencesRepo(new Db(c.env.DB), c.get("botId")).remove(c.req.param("id"));
  return c.redirect("/admin/seguimientos", 302);
});

// --- Conocimiento (KB editable, F4) -------------------------------------------

adminApp.get("/kb", async (c) =>
  c.html(
    await renderKbList(
      c.env,
      c.get("botId"),
      {
        saved: c.req.query("saved") === "1",
        deleted: c.req.query("deleted") === "1",
        reindexed: c.req.query("reindexed") ?? undefined,
      },
      visibleNavIds(c.get("kontroliaClaims")),
    ),
  ),
);

adminApp.get("/kb/new", (c) => c.html(renderKbEditor(null, c.env, visibleNavIds(c.get("kontroliaClaims")))));

adminApp.get("/kb/:id/edit", async (c) => {
  const db = new Db(c.env.DB);
  const doc = await new KbDocsRepo(db, c.get("botId")).getById(c.req.param("id"));
  if (!doc) return c.redirect("/admin/kb");
  return c.html(renderKbEditor(doc, c.env, visibleNavIds(c.get("kontroliaClaims"))));
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
    await renderMejoras(
      c.env,
      c.get("botId"),
      {
        found: c.req.query("found") ?? undefined,
        applied: c.req.query("applied") === "1",
        dismissed: c.req.query("dismissed") === "1",
      },
      visibleNavIds(c.get("kontroliaClaims")),
    ),
  ),
);

// Run the detectors on demand (they also run nightly from scheduled()).
adminApp.post("/mejoras/run", async (c) => {
  const denied = requirePermission(c, "nodia-agents.mejoras.administrar");
  if (denied) return denied;
  const r = await runFlywheel(c.env, c.get("botId"));
  return c.redirect(`/admin/mejoras?found=${r.created}`);
});

adminApp.post("/mejoras/:id/apply", async (c) => {
  const denied = requirePermission(c, "nodia-agents.mejoras.administrar");
  if (denied) return denied;
  const ok = await applySuggestion(c.env, c.req.param("id"), c.get("botId"));
  return c.redirect(ok ? "/admin/mejoras?applied=1" : "/admin/mejoras");
});

adminApp.post("/mejoras/:id/dismiss", async (c) => {
  const denied = requirePermission(c, "nodia-agents.mejoras.administrar");
  if (denied) return denied;
  const ok = await dismissSuggestion(c.env, c.req.param("id"), c.get("botId"));
  return c.redirect(ok ? "/admin/mejoras?dismissed=1" : "/admin/mejoras");
});

// Cambios al CRM propuestos por el agente. Van en la misma pestaña que las
// mejoras pero son otra cosa: aquéllas cambian cómo responde el bot, éstas
// tocan los datos de los clientes. Por eso ninguna se aplica sin este clic.
adminApp.post("/mejoras/crm/:id/aprobar", async (c) => {
  const denied = requirePermission(c, "nodia-agents.mejoras.administrar");
  if (denied) return denied;
  const botId = c.get("botId");
  const db = new Db(c.env.DB);
  const repo = new CrmProposalsRepo(db, botId);

  const propuesta = await repo.getById(c.req.param("id"));
  if (!propuesta) return c.redirect("/admin/mejoras");

  // `decidir` solo avanza desde 'pendiente': dos clics seguidos, o dos
  // pestañas abiertas, no escriben en el CRM dos veces.
  const tomada = await repo.decidir(propuesta.id, "aprobada");
  if (!tomada) return c.redirect("/admin/mejoras");

  const r = await ejecutarPropuesta(c.env, db, botId, propuesta);
  return c.redirect(r.ok ? "/admin/mejoras?crm=aplicada" : "/admin/mejoras?crm=fallida");
});

adminApp.post("/mejoras/crm/:id/rechazar", async (c) => {
  const denied = requirePermission(c, "nodia-agents.mejoras.administrar");
  if (denied) return denied;
  await new CrmProposalsRepo(new Db(c.env.DB), c.get("botId"))
    .decidir(c.req.param("id"), "rechazada")
    .catch(() => false);
  return c.redirect("/admin/mejoras?crm=rechazada");
});

// Autonomía del flywheel: manual (default) o copiloto (auto-aplica lo seguro
// en el cron nocturno — KB sin huecos y lecciones; lo delicado sigue en cola).
adminApp.post("/mejoras/autonomy", async (c) => {
  const denied = requirePermission(c, "nodia-agents.mejoras.administrar");
  if (denied) return denied;
  const form = await c.req.formData();
  const level = String(form.get("level") ?? "manual") === "copilot" ? "copilot" : "manual";
  await (await settingsFor(c)).set(SETTING_KEYS.autonomyLevel, level);
  return c.redirect("/admin/mejoras");
});

// Remove one lesson from the prompt (the ✕ next to each active lesson).
adminApp.post("/mejoras/lessons/remove", async (c) => {
  const denied = requirePermission(c, "nodia-agents.mejoras.administrar");
  if (denied) return denied;
  const form = await c.req.formData();
  const lesson = String(form.get("lesson") ?? "");
  const lessons = (await getLessons(c.env, c.get("botId"))).filter((l) => l !== lesson);
  await saveLessons(c.env, lessons, c.get("botId"));
  return c.redirect("/admin/mejoras");
});

// Inbox (F1): two-pane view. ?c=<id> selects the thread; ?f/?q filter the list.
adminApp.get("/conversations", async (c) =>
  c.html(
    await renderInbox(
      c.env,
      c.get("botId"),
      {
        search: c.req.query("q"),
        filter: c.req.query("f"),
        selectedId: c.req.query("c"),
      },
      visibleNavIds(c.get("kontroliaClaims")),
    ),
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
  return c.html(await renderInsights(c.env, botId, c.req.query("analyzed") ?? undefined, visibleNavIds(c.get("kontroliaClaims"))));
});

// "Analizar ahora": grade up to 10 pending conversations inline, then redirect
// back with the count for the confirmation banner.
adminApp.post("/insights/analyze", async (c) => {
  const result = await analyzeConversations(c.env, { limit: 10, botId: c.get("botId") });
  return c.redirect(`/admin/insights?analyzed=${result.analyzed}`);
});

// "Mi Agente": n8n-style canvas of how the bot works. The canvas fragment is
// polled by HTMX every 15s (live activity pulse); node panels load on click.
adminApp.get("/agente", async (c) => c.html(await renderAgentePage(c.env, c.get("botId"), visibleNavIds(c.get("kontroliaClaims")))));

adminApp.get("/agente/canvas", async (c) => c.html(await renderAgenteCanvas(c.env, c.get("botId"))));

adminApp.get("/agente/node/:id", async (c) =>
  c.html(await renderNodeModal(c.env, c.get("botId"), c.req.param("id"))),
);

// Save a node's config from its modal. Writes the relevant settings (with
// clamps), re-renders the modal with a saved banner + toast, and fires the
// `canvas-refresh` event so the diagram updates immediately.
adminApp.post("/agente/node/:id/save", async (c) => {
  const denied = requirePermission(c, "nodia-agents.agente.editar");
  if (denied) return denied;
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
  const denied = requirePermission(c, "nodia-agents.agente.editar");
  if (denied) return denied;
  const name = c.req.param("name");
  const ok = await toggleTool(c.env, c.get("botId"), name);
  if (!ok) return c.text("Tool no encontrada", 404);
  c.header("HX-Trigger", "canvas-refresh");
  return c.html((await renderNodeModal(c.env, c.get("botId"), `tool:${name}`, true)) + toastOob("✓ Guardado"));
});

adminApp.get("/leads", async (c) => c.html(await renderLeads(c.env, c.get("botId"), visibleNavIds(c.get("kontroliaClaims")))));

adminApp.get("/tickets", async (c) => c.html(await renderTickets(c.env, c.get("botId"), visibleNavIds(c.get("kontroliaClaims")))));

// Calendario (F5 Fase 2): agenda del bot — local, o el calendario conectado si hay uno.
adminApp.get("/calendario", async (c) =>
  c.html(
    await renderCalendario(
      c.env,
      c.get("botId"),
      c.req.query("month"),
      c.req.query("day"),
      visibleNavIds(c.get("kontroliaClaims")),
    ),
  ),
);

adminApp.post("/calendario/:id/cancel", async (c) => {
  const denied = requirePermission(c, "nodia-agents.calendario.administrar");
  if (denied) return denied;
  await cancelAppointment(c.env, c.get("botId"), c.req.param("id"));
  // Vuelve al mes/día que se estaba viendo (el panel del día seleccionado lo
  // manda como campo oculto) en vez de perder el lugar y saltar al mes actual.
  const form = await c.req.parseBody();
  const redirect = typeof form.redirect === "string" && form.redirect.startsWith("?") ? form.redirect : "";
  return c.redirect(`/admin/calendario${redirect}`, 302);
});

// Tu número (F7 fase 8): onboarding para conectar el número existente del
// cliente vía desvío de llamadas — máquina de estados propia (ver
// channels/voice/onboarding/), independiente de Conexiones.
adminApp.get("/telefono", async (c) =>
  c.html(
    await renderTelefono(
      c.env,
      c.get("botId"),
      { ok: c.req.query("ok") === "1", err: c.req.query("err") },
      visibleNavIds(c.get("kontroliaClaims")),
    ),
  ),
);

adminApp.post("/telefono/start", async (c) => {
  const form = await c.req.formData();
  const result = await startOnboarding(c.env, c.get("botId"), String(form.get("source_phone_number") ?? ""));
  if (!result.ok) return c.redirect(`/admin/telefono?err=${encodeURIComponent(result.error ?? "No se pudo continuar.")}`, 302);
  return c.redirect("/admin/telefono?ok=1", 302);
});

adminApp.post("/telefono/:id/activate", async (c) => {
  const ok = await activateOnboarding(c.env, c.get("botId"), c.req.param("id"));
  return c.redirect(ok ? "/admin/telefono?ok=1" : "/admin/telefono?err=No se pudo activar todavía.", 302);
});

adminApp.post("/telefono/:id/disable", async (c) => {
  await disableOnboarding(c.env, c.get("botId"), c.req.param("id"));
  return c.redirect("/admin/telefono?ok=1", 302);
});

adminApp.post("/telefono/:id/retry", async (c) => {
  const ok = await retryOnboarding(c.env, c.get("botId"), c.req.param("id"));
  return c.redirect(ok ? "/admin/telefono?ok=1" : "/admin/telefono?err=No se pudo reintentar.", 302);
});

// F7 fase 9: a qué número transfiere el agente cuando el cliente pide un
// humano — independiente del estado del onboarding (item de config, no de
// la máquina de estados de arriba).
adminApp.post("/telefono/transfer-number", async (c) => {
  const botId = c.get("botId");
  const form = await c.req.formData();
  const transferNumber = String(form.get("transfer_number") ?? "").trim();
  const db = new Db(c.env.DB);
  const repo = new BotChannelsRepo(db);
  const row = await repo.getByBotAndChannel(botId, "voice");
  if (!row) return c.redirect("/admin/telefono?err=Primero conecta Voice.", 302);
  await repo.updateConfig(botId, "voice", { ...row.config, transferNumber: transferNumber || undefined });
  return c.redirect("/admin/telefono?ok=1", 302);
});

// Conexiones: mapa de canales con estado verde/gris (paso 4 del onboarding),
// más las pestañas de conectores salientes (CRM, tickets, calendario, MCP).
adminApp.get("/conexiones", async (c) =>
  c.html(
    await renderConexiones(
      c.env,
      c.get("botId"),
      c.req.query("cat") ?? "canales",
      {
        ok: c.req.query("ok") === "1",
        err: c.req.query("err"),
      },
      visibleNavIds(c.get("kontroliaClaims")),
    ),
  ),
);

// Diálogo de conexión: instrucciones + formulario para pegar el token, sin
// terminal (F5/F4: cada bot conecta sus propios canales desde el panel).
adminApp.get("/conexiones/:channel/connect", (c) => {
  const channel = c.req.param("channel");
  if (channel !== "telegram" && channel !== "twilio" && channel !== "kapso" && channel !== "voice" && channel !== "manychat" && channel !== "widget") {
    return c.text("Canal desconocido", 404);
  }
  return c.html(renderConnectModal(channel));
});

adminApp.post("/conexiones/:channel/connect", async (c) => {
  const channel = c.req.param("channel");
  if (channel !== "telegram" && channel !== "twilio" && channel !== "kapso" && channel !== "voice" && channel !== "manychat" && channel !== "widget") {
    return c.text("Canal desconocido", 404);
  }
  const form = await c.req.formData();
  const modalHtml = await connectChannel(c.env, c.get("botId"), channel, form);
  // El modal de éxito viaja junto con un refresh OOB de la grilla de tarjetas
  // de atrás — así se ve verde de inmediato, sin recargar la página.
  const gridHtml = await renderConexionesGrid(c.env, c.get("botId"));
  return c.html(modalHtml + gridHtml);
});

// Correo entrante (Resend/Mailgun) — caso especial: dos proveedores para el
// MISMO canal (bot_channels sigue siendo "email" para ambos), por eso no
// pasa por las rutas genéricas de :channel. "/conexiones/email/disconnect"
// tiene la MISMA forma que "/conexiones/:channel/disconnect" de abajo — va
// ANTES a propósito (mismo motivo que /habilidades/llaves antes de
// /habilidades/:id): si no, el genérico la interceptaría con channel="email"
// y la rechazaría en su allow-list antes de llegar aquí.
adminApp.post("/conexiones/email/disconnect", async (c) => {
  await disconnectEmailChannel(c.env, c.get("botId"));
  return c.redirect("/admin/conexiones", 302);
});

// Estas SÍ pueden ir en cualquier orden respecto al genérico: tienen 3
// segmentos ("email/:provider/connect"), el genérico tiene 2
// ("_:channel/connect_"), formas distintas, sin ambigüedad de ruteo.
adminApp.get("/conexiones/email/:provider/connect", (c) => {
  const provider = c.req.param("provider");
  if (provider !== "resend" && provider !== "mailgun") return c.text("Proveedor desconocido", 404);
  return c.html(renderEmailConnectModal(c.env, c.get("botId"), provider));
});

adminApp.post("/conexiones/email/:provider/connect", async (c) => {
  const provider = c.req.param("provider");
  if (provider !== "resend" && provider !== "mailgun") return c.text("Proveedor desconocido", 404);
  const form = await c.req.formData();
  const modalHtml = await connectEmailChannel(c.env, c.get("botId"), provider, form);
  const gridHtml = await renderConexionesGrid(c.env, c.get("botId"));
  return c.html(modalHtml + gridHtml);
});

adminApp.post("/conexiones/:channel/disconnect", async (c) => {
  const channel = c.req.param("channel");
  if (channel !== "telegram" && channel !== "twilio" && channel !== "kapso" && channel !== "voice" && channel !== "manychat" && channel !== "widget") {
    return c.text("Canal desconocido", 404);
  }
  await disconnectChannel(c.env, c.get("botId"), channel);
  return c.redirect("/admin/conexiones", 302);
});

// Config visual del widget (posición/color/saludo) — no pasa por
// connectChannel(): no crea/renueva la conexión, solo actualiza `config`.
adminApp.post("/conexiones/widget/config", async (c) => {
  await saveWidgetConfig(c.env, c.get("botId"), await c.req.formData());
  return c.redirect("/admin/conexiones?ok=1", 302);
});

// Conectores salientes (CRM/Tickets/Calendario/MCP) — mismo diálogo guiado,
// pero el bot LLAMA a la API externa con un API key propio en vez de recibir
// un webhook.
const CONNECTOR_CATEGORIES = ["crm", "tickets", "calendar", "mcp"];

adminApp.get("/conexiones/connectors/:category/:provider/connect", (c) => {
  const category = c.req.param("category");
  const provider = c.req.param("provider");
  if (!CONNECTOR_CATEGORIES.includes(category)) return c.text("Categoría desconocida", 404);
  if (categoryOfProvider(provider) !== category) return c.text("Conector desconocido", 404);
  return c.html(renderConnectorConnectModal(category as ConnectorCategory, provider));
});

adminApp.post("/conexiones/connectors/:category/:provider/connect", async (c) => {
  const category = c.req.param("category");
  const provider = c.req.param("provider");
  if (!CONNECTOR_CATEGORIES.includes(category)) return c.text("Categoría desconocida", 404);
  if (categoryOfProvider(provider) !== category) return c.text("Conector desconocido", 404);
  const form = await c.req.formData();
  const modalHtml = await connectConnector(c.env, c.get("botId"), category as ConnectorCategory, provider, form);
  const gridHtml = await renderConnectorsGrid(c.env, c.get("botId"), category as ConnectorCategory);
  return c.html(modalHtml + gridHtml);
});

adminApp.post("/conexiones/connectors/:provider/disconnect", async (c) => {
  const provider = c.req.param("provider");
  const category = categoryOfProvider(provider);
  if (!category) return c.text("Conector desconocido", 404);
  await disconnectConnector(c.env, c.get("botId"), provider);
  return c.redirect(`/admin/conexiones?cat=${category}`, 302);
});

// Conectores MCP: sin catálogo fijo, el usuario da de alta los suyos (nombre + URL + token opcional).
adminApp.get("/conexiones/connectors/mcp/add", (c) => c.html(renderMcpConnectModal()));

adminApp.post("/conexiones/connectors/mcp/add", async (c) => {
  const form = await c.req.formData();
  const modalHtml = await connectMcp(c.env, c.get("botId"), form);
  const gridHtml = await renderConnectorsGrid(c.env, c.get("botId"), "mcp");
  return c.html(modalHtml + gridHtml);
});

adminApp.get("/conexiones/connectors/mcp/:provider/tools", async (c) => {
  const provider = c.req.param("provider");
  return c.html(await renderMcpToolsModal(c.env, c.get("botId"), provider));
});

// Propósito del conector: lo único que el servidor MCP no puede autodescribir
// (qué hace cada tool ya viene en tools/list; cuándo el negocio la quiere, no).
adminApp.get("/conexiones/connectors/mcp/:provider/editar", async (c) => {
  const provider = c.req.param("provider");
  return c.html(await renderMcpEditModal(c.env, c.get("botId"), provider));
});

adminApp.post("/conexiones/connectors/mcp/:provider/editar", async (c) => {
  const provider = c.req.param("provider");
  const modalHtml = await saveMcpPurpose(c.env, c.get("botId"), provider, await c.req.formData());
  const gridHtml = await renderConnectorsGrid(c.env, c.get("botId"), "mcp");
  return c.html(modalHtml + gridHtml);
});

// En qué etapa de su pipeline cae la oportunidad inicial de un CRM conectado
// (F-CRM-completo) — se elige de una lista con las etapas reales de la
// cuenta, no un ID a mano.
adminApp.get("/conexiones/connectors/crm/:provider/etapa", async (c) => {
  const provider = c.req.param("provider");
  return c.html(await renderPipelineStageModal(c.env, c.get("botId"), provider));
});

adminApp.post("/conexiones/connectors/crm/:provider/etapa", async (c) => {
  const provider = c.req.param("provider");
  const modalHtml = await savePipelineStage(c.env, c.get("botId"), provider, await c.req.formData());
  const gridHtml = await renderConnectorsGrid(c.env, c.get("botId"), "crm");
  return c.html(modalHtml + gridHtml);
});

// Config posterior a un OAuth (ej. Project Key de Jira) — solo config, nunca el token.
adminApp.post("/conexiones/connectors/:provider/config", async (c) => {
  const provider = c.req.param("provider");
  await updateConnectorConfig(c.env, c.get("botId"), provider, await c.req.formData());
  const category = categoryOfProvider(provider);
  return c.redirect(`/admin/conexiones${category ? `?cat=${category}` : ""}`, 302);
});

// Conectores OAuth (Google Calendar, Jira): "Conectar" redirige de verdad al
// consentimiento del proveedor — no es un diálogo HTMX como los de API key.
const OAUTH_STATE_COOKIE = "nodia_oauth_state";

adminApp.get("/conexiones/oauth/:provider/start", (c) => {
  const provider = c.req.param("provider");
  const result = startOAuth(c.env, provider, c.get("botId"));
  if ("error" in result) return c.redirect(`/admin/conexiones?err=${encodeURIComponent(result.error)}`, 302);
  setCookie(c, OAUTH_STATE_COOKIE, JSON.stringify(result.state), {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: 600,
  });
  return c.redirect(result.url, 302);
});

adminApp.get("/conexiones/oauth/:provider/callback", async (c) => {
  const provider = c.req.param("provider");
  const cookieRaw = getCookie(c, OAUTH_STATE_COOKIE);
  const { redirectTo } = await handleOAuthCallback(
    c.env,
    provider,
    { code: c.req.query("code"), state: c.req.query("state"), error: c.req.query("error") },
    cookieRaw,
  );
  deleteCookie(c, OAUTH_STATE_COOKIE);
  return c.redirect(redirectTo, 302);
});

// Conectores MCP genéricos por OAuth 2.1 (F-MCP-OAuth): a diferencia de
// google-calendar/jira de arriba (proveedor fijo, client_id de ENV), aquí
// el "proveedor" es CUALQUIER URL que el dueño pegue — el client_id sale de
// registro dinámico (RFC7591) salvo que el dueño pegue uno fijo (ver
// startMcpOAuth) — y ese registro + el code_verifier de PKCE también tienen
// que viajar en la cookie de state (ver connectors/mcpOAuth.ts). El
// protocolo en sí (discovery, DCR, PKCE, intercambio de tokens) lo resuelve
// @ai-sdk/mcp — auth() — no se reimplementa.
const MCP_OAUTH_STATE_COOKIE = "nodia_mcp_oauth_state";

adminApp.get("/conexiones/connectors/mcp/oauth/start", async (c) => {
  const name = c.req.query("name") ?? "";
  const url = c.req.query("url") ?? "";
  const clientId = c.req.query("client_id") ?? "";
  const purpose = c.req.query("purpose") ?? "";
  const result = await startMcpOAuth(c.env, c.get("botId"), name, url, clientId, purpose);
  if ("error" in result) return c.redirect(`/admin/conexiones?cat=mcp&err=${encodeURIComponent(result.error)}`, 302);
  setCookie(c, MCP_OAUTH_STATE_COOKIE, JSON.stringify(result.state), {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: 600,
  });
  return c.redirect(result.url, 302);
});

// Termina en "/oauth/callback" — cae en AUTH_EXEMPT_SUFFIXES (pensado para
// /conexiones/oauth/:provider/callback de arriba) y por eso corre SIN el
// middleware de tenant: c.get("botId") es undefined aquí. El botId real
// viaja en la cookie de state (guardado en /start) — ver mcpOAuthConnect.ts.
adminApp.get("/conexiones/connectors/mcp/oauth/callback", async (c) => {
  const cookieRaw = getCookie(c, MCP_OAUTH_STATE_COOKIE);
  const { redirectTo } = await handleMcpOAuthCallback(
    c.env,
    { code: c.req.query("code"), state: c.req.query("state"), error: c.req.query("error") },
    cookieRaw,
  );
  deleteCookie(c, MCP_OAUTH_STATE_COOKIE);
  return c.redirect(redirectTo, 302);
});

adminApp.get("/campanas", async (c) => {
  const q: Record<string, string | undefined> = {
    ok: c.req.query("ok"),
    err: c.req.query("err"),
    audience: c.req.query("audience"),
    enqueued: c.req.query("enqueued"),
    skipped: c.req.query("skipped"),
  };
  return c.html(await renderCampanas(c.env, c.get("botId"), q, visibleNavIds(c.get("kontroliaClaims"))));
});

// Vista previa en vivo del conteo de audiencia — se llama con htmx cada vez
// que el dueño cambia un filtro, sin recargar la página ni tocar la cuota.
// Devuelve el banner de audiencia (swap normal) + el resumen de la derecha
// (out-of-band) para que ambos reflejen los mismos filtros a la vez.
adminApp.post("/campanas/preview", async (c) => {
  const form = await c.req.formData();
  const filters = parseCampaignFilters(form);
  const botId = c.get("botId");
  const db = new Db(c.env.DB);
  const [counts, templates] = await Promise.all([
    segmentCount(db, botId, filters),
    listContentTemplates(c.env).catch(() => []),
  ]);
  const templateSid = String(form.get("template_sid") ?? "").trim();
  const campaignKey = String(form.get("campaign_key") ?? "").trim();
  return c.html(
    renderLivePreview(counts, {
      hasTemplateSelected: templateSid !== "",
      hasAnyTemplate: templates.length > 0,
      campaignKeyPresent: campaignKey !== "",
    }),
  );
});

adminApp.post("/campanas/send", async (c) => {
  const denied = requirePermission(c, "nodia-agents.campanas.enviar");
  if (denied) return denied;
  const form = await c.req.formData();
  const filters = parseCampaignFilters(form);
  const campaignKey = String(form.get("campaign_key") ?? "").trim();
  const freeformText = String(form.get("freeform_text") ?? "").trim();
  const templateSid = String(form.get("template_sid") ?? "").trim();
  const varsRaw = String(form.get("template_vars") ?? "").trim();
  if (!campaignKey || (!freeformText && !templateSid)) {
    return c.redirect("/admin/campanas?err=" + encodeURIComponent("Falta el nombre de campaña, o un mensaje/plantilla."));
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
    const tpl = (await listContentTemplates(c.env).catch(() => [])).find((t) => t.sid === templateSid);
    templateBody = tpl?.body || undefined;
  }
  // F6: ya no se manda aquí mismo — se encola, y el tick de cada minuto la
  // va procesando en lotes (así una campaña de miles no muere a medias por
  // el límite de tiempo de la función). Ver src/campaigns.ts.
  const result = await enqueueCampaign(c.env, {
    filters,
    campaignKey,
    freeformText: freeformText || undefined,
    template: templateSid ? { sid: templateSid, variables, body: templateBody } : undefined,
    botId: c.get("botId"),
  });
  const q = new URLSearchParams({
    ok: "1",
    audience: String(result.audience),
    enqueued: String(result.enqueued),
    skipped: String(result.skipped),
  });
  return c.redirect("/admin/campanas?" + q.toString());
});

adminApp.get("/config", async (c) => {
  const configDb = new Db(c.env.DB);
  const configBotId = c.get("botId");
  const settings = await new SettingsRepo(configDb, configBotId).all();
  const bot = await new BotsRepo(configDb).getById(configBotId);
  const mcpConnectors = (await new BotConnectorsRepo(configDb).listByBot(configBotId)).filter(
    (conn) => conn.category === "mcp" && conn.enabled,
  );
  const saved = c.req.query("saved") === "1";
  return c.html(
    renderConfig(
      settings,
      bot?.config ?? {},
      { name: bot?.name ?? c.env.BOT_NAME, businessName: bot?.business_name ?? c.env.BUSINESS_NAME },
      saved,
      c.req.query("llmtest"),
      Boolean(c.env.OPENAI_API_KEY),
      { niche: bot?.niche ?? null, language: bot?.language ?? c.env.BOT_LANGUAGE },
      mcpConnectors.map((conn) => ({ name: conn.name, provider: conn.provider })),
      visibleNavIds(c.get("kontroliaClaims")),
    ),
  );
});

const SUGGEST_FIELDS_SCHEMA = z.object({
  fields: z
    .array(z.object({ key: z.string().min(1).max(60), placeholder: z.string().max(120).optional() }))
    .min(3)
    .max(8),
});

/** Sin niche, LLM no configurado, o falla la llamada: siempre hay algo que mostrar, nunca deja al dueño sin nada. */
const FALLBACK_SUGGEST_FIELDS = [
  { key: "Especialidad", placeholder: "Ej. lo que más te distingue de otros negocios similares" },
  { key: "Garantía o política de devolución", placeholder: "" },
  { key: "Requisitos previos", placeholder: "Ej. qué necesita traer o saber el cliente antes de venir" },
];

// Sugiere campos de "Información del negocio" según el giro que el dueño
// escribió — un click, una llamada corta al LLM ya configurado del bot
// (mismo patrón que /config/llm-test), nunca bloquea el flujo si falla.
adminApp.post("/config/suggest-fields", async (c) => {
  const form = await c.req.formData();
  const niche = String(form.get("niche") ?? "").trim().slice(0, 200);
  if (!niche) return c.json({ fields: FALLBACK_SUGGEST_FIELDS });
  try {
    const ov = await loadLlmOverrides(c.env, c.get("botId"));
    const { model } = createModel(c.env, "fast", ov);
    const result = await generateObject({
      model,
      schema: SUGGEST_FIELDS_SCHEMA,
      prompt: `Un dueño de un negocio de giro "${niche}" está configurando un chatbot de atención al cliente. Sugiere entre 4 y 8 datos ESPECÍFICOS de ese giro que un cliente típicamente preguntaría y que el dueño debería capturar — cada uno como un campo corto "nombre del dato" + un placeholder de ejemplo para el valor. NO sugieras horario, precios/catálogo, ubicación, métodos de pago, teléfono ni sitio web — esos ya se capturan aparte. Responde en español, campos concretos y accionables para ESTE giro, no genéricos.`,
    });
    return c.json(result.object);
  } catch (err) {
    console.error("[config] suggest-fields falló:", err);
    return c.json({ fields: FALLBACK_SUGGEST_FIELDS });
  }
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
      // OpenAI exige max_output_tokens >= 16 (con menos, tira 400 antes de
      // generar nada) — 20 da margen sin volverse una prueba lenta/cara.
      maxOutputTokens: 20,
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

const CUSTOM_FIELDS_SCHEMA = z.record(z.string(), z.string());
const CATALOG_SCHEMA = z.array(
  z.object({ name: z.string().min(1), price: z.number(), description: z.string().optional(), sku: z.string().optional() }),
);

/** JSON malformado no debe tumbar el guardado completo — se ignora esa llave del patch (log + skip), como el resto de parseos defensivos de este archivo. */
function parseCustomFieldsJson(raw: string): Record<string, string> | undefined {
  try {
    const parsed = CUSTOM_FIELDS_SCHEMA.parse(JSON.parse(raw));
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const key = k.trim();
      if (key) cleaned[key] = v.trim();
    }
    return cleaned;
  } catch (err) {
    console.error("[config] custom_fields_json inválido, se ignora:", err);
    return undefined;
  }
}

function parseCatalogJson(raw: string): BotCatalogItem[] | undefined {
  try {
    return CATALOG_SCHEMA.parse(JSON.parse(raw));
  } catch (err) {
    console.error("[config] catalog_json inválido, se ignora:", err);
    return undefined;
  }
}

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
    SETTING_KEYS.salesPlaybook,
    SETTING_KEYS.voiceName,
    SETTING_KEYS.voiceGreeting,
    SETTING_KEYS.voiceVadSilenceMs,
    SETTING_KEYS.agentMode,
    SETTING_KEYS.botObjective,
  ];
  for (const key of textKeys) {
    const raw = form.get(key);
    if (raw === null) continue;
    await repo.set(key, String(raw).trim());
  }

  // Giro e idioma viven en columnas de `bots`, no en `settings` — angostos a
  // propósito (BotsRepo.updateNiche/updateLanguage), así no hace falta
  // resuministrar name/businessName/tier en cada guardado del panel.
  const configBotId = c.get("botId");
  const botsRepo = new BotsRepo(new Db(c.env.DB));
  const nicheRaw = form.get("niche");
  if (nicheRaw !== null) await botsRepo.updateNiche(configBotId, String(nicheRaw));
  const languageRaw = form.get("bot_language");
  if (languageRaw !== null && String(languageRaw).trim() !== "") {
    await botsRepo.updateLanguage(configBotId, String(languageRaw));
  }
  // El nombre vive en LOS DOS lados y hay que moverlos juntos: settings.bot_name
  // (arriba, en textKeys) es lo que lee el agente; bots.name es lo que pinta el
  // panel (selector, /admin/projects, leads, overview). Vacío = el dueño borró el
  // campo para volver al default — settings-loader.ts ya cae a identity.name en
  // ese caso, así que bots.name se deja intacto en vez de guardar "".
  const botNameRaw = form.get(SETTING_KEYS.botName);
  if (botNameRaw !== null && String(botNameRaw).trim() !== "") {
    await botsRepo.updateName(configBotId, String(botNameRaw));
  }

  // Todo lo demás de "Información del negocio" vive en bots.config (JSONB) —
  // un solo mergeConfig() al final para no pisar lo que otras llaves ya
  // tengan guardado (catalog, customFields, etc. son objetos completos, no
  // se mezclan entre sí, pero SÍ se preservan las llaves del patch que este
  // guardado no tocó).
  const configPatch: Partial<BotConfig> = {};
  const countryRaw = form.get("country");
  if (countryRaw !== null) configPatch.country = String(countryRaw).trim().slice(0, 80);
  const currencyRaw = form.get("currency");
  if (currencyRaw !== null) configPatch.currency = String(currencyRaw).trim().slice(0, 40);

  // Datos básicos del negocio — antes solo se cargaban una vez desde el
  // skill de onboarding y no había forma de verlos/editarlos/borrarlos desde
  // el panel (quedaban "fantasma": el bot los seguía usando, pero nadie
  // podía saber de dónde salían ni corregirlos). Ahora son campos explícitos
  // aquí, y un valor vacío SÍ los borra (mismo mergeConfig de siempre).
  const hoursRaw = form.get("hours");
  if (hoursRaw !== null) configPatch.hours = String(hoursRaw).trim().slice(0, 300);
  const locationRaw = form.get("location");
  if (locationRaw !== null) configPatch.location = String(locationRaw).trim().slice(0, 300);
  const contactPhoneRaw = form.get("contact_phone");
  if (contactPhoneRaw !== null) configPatch.contactPhone = String(contactPhoneRaw).trim().slice(0, 60);
  const websiteRaw = form.get("website");
  if (websiteRaw !== null) configPatch.website = String(websiteRaw).trim().slice(0, 200);
  const paymentMethodsRaw = form.get("payment_methods");
  if (paymentMethodsRaw !== null) {
    configPatch.paymentMethods = String(paymentMethodsRaw)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const customFieldsRaw = form.get("custom_fields_json");
  if (customFieldsRaw !== null) {
    const parsed = parseCustomFieldsJson(String(customFieldsRaw));
    if (parsed) configPatch.customFields = parsed;
  }
  const catalogRaw = form.get("catalog_json");
  if (catalogRaw !== null) {
    const parsed = parseCatalogJson(String(catalogRaw));
    if (parsed) {
      configPatch.catalog = parsed;
      // `services` es el campo viejo que reemplazó "Catálogo" — se precargó
      // en el editor (ver config.ts) si nunca se había migrado. Cualquier
      // guardado del catálogo completa esa migración: de aquí en adelante
      // `catalog` es la única fuente, así esto no puede volver a quedar
      // fantasma. `undefined` borra la llave del JSON (mergeConfig hace
      // JSON.stringify, que omite las propiedades undefined).
      configPatch.services = undefined;
    }
  }
  const catalogSourceRaw = form.get("catalog_source");
  if (catalogSourceRaw !== null) configPatch.catalogSource = catalogSourceRaw === "mcp" ? "mcp" : "manual";

  if (Object.keys(configPatch).length > 0) await botsRepo.mergeConfig(configBotId, configPatch);

  // Zona horaria: allow-list contra TIMEZONE_OPTIONS — nunca texto libre.
  const tzRaw = form.get(SETTING_KEYS.timezone);
  if (tzRaw !== null) {
    await repo.set(SETTING_KEYS.timezone, resolveTimezone(String(tzRaw)));
  }

  // BYO-LLM: proveedor y modelo se guardan tal cual (allow-list de valores).
  const provRaw = form.get(SETTING_KEYS.llmProvider);
  if (provRaw !== null) {
    const v = String(provRaw).trim().toLowerCase();
    await repo.set(
      SETTING_KEYS.llmProvider,
      v === "anthropic" || v === "openai" || v === "xai" || v === "deepseek" ? v : "",
    );
  }
  const modelRaw = form.get(SETTING_KEYS.llmModel);
  if (modelRaw !== null) {
    await repo.set(SETTING_KEYS.llmModel, String(modelRaw).trim().slice(0, 100));
    // Guardar de nuevo (aunque sea el mismo modelo) es la señal de que el
    // dueño ya lo revisó — se apaga el aviso de "modelo degradado".
    await repo.set(SETTING_KEYS.llmModelWarning, "");
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

  // Respaldo de otro proveedor (mismo patrón que el BYO-LLM de arriba).
  const backupProvRaw = form.get(SETTING_KEYS.llmBackupProvider);
  if (backupProvRaw !== null) {
    const v = String(backupProvRaw).trim().toLowerCase();
    await repo.set(
      SETTING_KEYS.llmBackupProvider,
      v === "anthropic" || v === "openai" || v === "xai" || v === "deepseek" ? v : "",
    );
  }
  if (form.get("llm_backup_api_key_clear") === "1") {
    await repo.set(SETTING_KEYS.llmBackupApiKey, "");
  } else {
    const backupKeyRaw = form.get(SETTING_KEYS.llmBackupApiKey);
    if (backupKeyRaw !== null && String(backupKeyRaw).trim() !== "") {
      await repo.set(SETTING_KEYS.llmBackupApiKey, String(backupKeyRaw).trim());
    }
  }

  // API key de OpenAI para Voz (Realtime) — mismo patrón que la de arriba.
  if (form.get("voice_openai_api_key_clear") === "1") {
    await repo.set(SETTING_KEYS.voiceOpenAiApiKey, "");
  } else {
    const voiceKeyRaw = form.get(SETTING_KEYS.voiceOpenAiApiKey);
    if (voiceKeyRaw !== null && String(voiceKeyRaw).trim() !== "") {
      await repo.set(SETTING_KEYS.voiceOpenAiApiKey, String(voiceKeyRaw).trim());
    }
  }

  // Correo saliente (/admin/config → Correo saliente) — DECIDIDO APARTE de
  // quién recibe (eso es /admin/conexiones → bot_channels canal "email").
  // Proveedor con allow-list (mismo criterio que llmProvider arriba);
  // dominio/remitente texto libre; API key con el mismo patrón de
  // clear-checkbox que la de BYO-LLM y la de Voz.
  const emailProviderRaw = form.get(SETTING_KEYS.emailOutboundProvider);
  if (emailProviderRaw !== null) {
    const v = String(emailProviderRaw).trim().toLowerCase();
    await repo.set(SETTING_KEYS.emailOutboundProvider, v === "resend" || v === "mailgun" ? v : "");
  }
  const emailDomainRaw = form.get(SETTING_KEYS.emailOutboundDomain);
  if (emailDomainRaw !== null) await repo.set(SETTING_KEYS.emailOutboundDomain, String(emailDomainRaw).trim());
  const emailFromAddressRaw = form.get(SETTING_KEYS.emailFromAddress);
  if (emailFromAddressRaw !== null) await repo.set(SETTING_KEYS.emailFromAddress, String(emailFromAddressRaw).trim());
  const emailFromNameRaw = form.get(SETTING_KEYS.emailFromName);
  if (emailFromNameRaw !== null) await repo.set(SETTING_KEYS.emailFromName, String(emailFromNameRaw).trim());
  if (form.get("email_outbound_api_key_clear") === "1") {
    await repo.set(SETTING_KEYS.emailOutboundApiKey, "");
  } else {
    const emailKeyRaw = form.get(SETTING_KEYS.emailOutboundApiKey);
    if (emailKeyRaw !== null && String(emailKeyRaw).trim() !== "") {
      await repo.set(SETTING_KEYS.emailOutboundApiKey, String(emailKeyRaw).trim());
    }
  }

  return c.redirect("/admin/config?saved=1");
});

// --- CSV export -------------------------------------------------------------

adminApp.get("/leads/export.csv", async (c) => {
  const denied = requirePermission(c, "nodia-agents.leads.administrar");
  if (denied) return denied;
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
  const denied = requirePermission(c, "nodia-agents.leads.administrar");
  if (denied) return denied;
  const db = new Db(c.env.DB);
  const botId = c.get("botId");
  // Con un CRM conectado, ESE es la fuente de verdad del pipeline de ventas
  // — /admin/leads ya no ofrece el selector (ver admin/views/leads.ts), pero
  // el bloqueo real tiene que estar aquí: sin esto, un POST directo a esta
  // ruta seguiría pudiendo desincronizar el estado local del que vive en el
  // CRM.
  const crmConnector = await new BotConnectorsRepo(db).getActiveByCategory(botId, "crm");
  if (crmConnector) {
    return c.text("El estado de este lead se administra desde el CRM conectado.", 409);
  }
  const form = await c.req.formData();
  const raw = String(form.get("status") ?? "new");
  const status: Lead["status"] = (LEAD_STATUSES as readonly string[]).includes(raw)
    ? (raw as Lead["status"])
    : "new";
  const leads = new LeadsRepo(db, botId);
  await leads.setStatus(c.req.param("id"), status);
  return c.redirect("/admin/leads");
});

// Inscribir/detener a un lead en una secuencia de seguimiento (F8 fase C).
adminApp.post("/leads/:id/seguimiento/iniciar", async (c) => {
  const denied = requirePermission(c, "nodia-agents.seguimientos.administrar");
  if (denied) return denied;
  const form = await c.req.formData();
  const sequenceId = String(form.get("sequence_id") ?? "").trim();
  if (sequenceId) {
    await enrollLeadInSequence(c.env, c.get("botId"), c.req.param("id"), sequenceId);
  }
  return c.redirect("/admin/leads");
});

adminApp.post("/leads/:id/seguimiento/detener", async (c) => {
  const denied = requirePermission(c, "nodia-agents.seguimientos.administrar");
  if (denied) return denied;
  // Cuál detener. El panel siempre lo manda (cada seguimiento trae su propio
  // botón); sin él se detienen TODOS, que es lo que hacía antes de que un lead
  // pudiera estar en varios.
  const form = await c.req.formData();
  const sequenceId = String(form.get("sequence_id") ?? "").trim() || undefined;
  await stopSequenceForLead(c.env, c.get("botId"), c.req.param("id"), "detenido_manual", sequenceId);
  return c.redirect("/admin/leads");
});

// Resolve a support ticket.
adminApp.post("/tickets/:id/resolve", async (c) => {
  const denied = requirePermission(c, "nodia-agents.tickets.administrar");
  if (denied) return denied;
  const form = await c.req.formData();
  const resolvedBy = String(form.get("resolved_by") ?? c.env.OWNER_EMAIL ?? "admin").trim() || "admin";
  const db = new Db(c.env.DB);
  const tickets = new TicketsRepo(db, c.get("botId"));
  await tickets.resolve(c.req.param("id"), resolvedBy);
  return c.redirect("/admin/tickets");
});

adminApp.post("/tickets/:id/priority", async (c) => {
  const denied = requirePermission(c, "nodia-agents.tickets.administrar");
  if (denied) return denied;
  const form = await c.req.formData();
  await updateTicketPriority(c.env, c.get("botId"), c.req.param("id"), String(form.get("priority") ?? ""));
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
  const denied = requirePermission(c, "nodia-agents.conversaciones.responder");
  if (denied) return denied;
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
  const denied = requirePermission(c, "nodia-agents.conversaciones.responder");
  if (denied) return denied;
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
  const denied = requirePermission(c, "nodia-agents.conversaciones.responder");
  if (denied) return denied;
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

// Manual "Crear ticket" from the panel — the owner is already looking at the
// conversation, so unlike handoffHuman.ts (the agent's own tool) this skips
// the owner notification (email/Telegram/WhatsApp ping): there's no one to
// notify who isn't already here. It still pushes to an external tickets
// platform if one is connected, same as the agent-created path.
adminApp.post("/conversations/:id/create-ticket", async (c) => {
  const denied = requirePermission(c, "nodia-agents.conversaciones.responder");
  if (denied) return denied;
  const id = c.req.param("id");
  const db = new Db(c.env.DB);
  const botId = c.get("botId");
  const convs = new ConversationsRepo(db, botId);
  const conv = await convs.getById(id);
  if (!conv) return c.html(await renderThreadLive(c.env, botId, id));

  const history = await new MessagesRepo(db, botId).lastN(id, 20);
  const transcript = history.map((m) => `${m.role === "user" ? "Cliente" : "Bot"}: ${m.content}`).join("\n");

  const ticketId = await new TicketsRepo(db, botId).create({
    conversationId: id,
    category: "other",
    summary: "Ticket creado manualmente desde el panel de conversaciones",
    transcript,
    requesterName: conv.display_name,
    requesterContact: conv.channel_user_id,
  });
  await convs.setOpenTicket(id, ticketId);
  await pushToTicketsIfConnected(
    c.env,
    db,
    botId,
    ticketId,
    "Ticket creado manualmente desde el panel de conversaciones",
    "other",
    "normal",
    conv.display_name,
    conv.channel_user_id,
  );

  return c.html(await renderThreadLive(c.env, botId, id));
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
