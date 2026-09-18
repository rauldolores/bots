// F5 de docs/multitenancy.md: login del panel con KontrolIA Auth.
//
// auth-server ES el GoTrue del proyecto de Supabase compartido — no hay un
// servidor OAuth aparte que registrar. El SDK oficial (@kontrolia/auth) trae
// el flujo completo (buildOAuthServerAuthorizeUrl/exchangeOAuthServerCode),
// pero esos métodos viven en KontroliaClient, que usa createBrowserClient de
// @supabase/ssr — piensa en cookies de navegador y no corre en Node.
//
// Este panel es HTML de servidor (htmx), sin bundle de JS propio. En vez de
// meter un paso de empaquetado solo para esto, se reimplementan aquí las
// MISMAS dos llamadas que hace el SDK por debajo (confirmado leyendo
// dist/client.js de @kontrolia/auth 2.1.0): generar el par PKCE es
// criptografía estándar (RFC 7636, Web Crypto — igual en navegador que en
// Node), y el intercambio de código es un POST plano a
// /auth/v1/oauth/token. Cero magia oculta del SDK que se esté saltando.
//
// La verificación del token SÍ usa el SDK (@kontrolia/auth/server,
// verifyRequest) — ahí no hay atajo: es JWT contra el JWKS del proyecto.
import { verifyRequest, listMemberships as sdkListMemberships } from "@kontrolia/auth/server";
import type { KontroliaMembershipWithOrganization } from "@kontrolia/shared";
import type { Env } from "../env";

export const SESSION_COOKIE = "nodia_kontrolia_session";
export const VERIFIER_COOKIE = "nodia_oauth_verifier";

export interface KontroliaSession {
  accessToken: string;
  refreshToken: string;
  /** epoch ms — cuándo deja de servir el access_token (no el refresh_token). */
  expiresAt: number;
}

export interface KontroliaAuthConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  clientId: string;
}

/** Ninguna de las tres es opcional para que el login funcione — si falta una, no hay login (Basic Auth sigue viva). */
export function kontroliaConfig(env: Env): KontroliaAuthConfig | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.OAUTH_CLIENT_ID) return null;
  return {
    supabaseUrl: env.SUPABASE_URL.replace(/\/$/, ""),
    supabaseAnonKey: env.SUPABASE_ANON_KEY,
    clientId: env.OAUTH_CLIENT_ID,
  };
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC 7636, method S256 — mismo algoritmo que @kontrolia/auth's generatePkcePair(). */
export async function generatePkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64UrlEncode(new Uint8Array(digest));
  return { verifier, challenge };
}

export async function buildAuthorizeUrl(
  cfg: KontroliaAuthConfig,
  redirectUri: string,
  state?: string,
): Promise<{ url: string; codeVerifier: string }> {
  const { verifier, challenge } = await generatePkcePair();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "openid",
  });
  if (state) params.set("state", state);
  return { url: `${cfg.supabaseUrl}/auth/v1/oauth/authorize?${params.toString()}`, codeVerifier: verifier };
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

function toSession(tokens: TokenResponse): KontroliaSession {
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    // Margen de 30s: más vale refrescar un poco antes que dejar pasar un
    // request con un token que expiró a mitad de camino.
    expiresAt: Date.now() + Math.max(0, tokens.expires_in - 30) * 1000,
  };
}

export async function exchangeCode(
  cfg: KontroliaAuthConfig,
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<KontroliaSession> {
  const res = await fetch(`${cfg.supabaseUrl}/auth/v1/oauth/token`, {
    method: "POST",
    headers: { apikey: cfg.supabaseAnonKey, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: cfg.clientId,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) {
    throw new Error(`Intercambio de código OAuth falló (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  return toSession((await res.json()) as TokenResponse);
}

/**
 * La sesión nació del flujo OAuth (exchangeCode, arriba) — GoTrue exige
 * refrescarla por el MISMO endpoint OAuth con client_id, no por el genérico
 * /auth/v1/token?grant_type=refresh_token (ese responde 400 invalid_client:
 * "Client authentication required for OAuth session" — confirmado a mano
 * contra el proyecto real antes de escribir esto).
 */
export async function refreshSession(
  cfg: KontroliaAuthConfig,
  refreshToken: string,
): Promise<KontroliaSession | null> {
  const res = await fetch(`${cfg.supabaseUrl}/auth/v1/oauth/token`, {
    method: "POST",
    headers: { apikey: cfg.supabaseAnonKey, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: cfg.clientId,
    }),
  });
  if (!res.ok) return null;
  return toSession((await res.json()) as TokenResponse);
}

/**
 * Cierra la sesión EN GOTRUE, no solo en este panel.
 *
 * Borrar la cookie del bot no era cerrar sesión: /admin/login rebota a
 * /oauth/authorize, y como el auth-server todavía tenía la sesión del
 * usuario en el navegador, autorizaba al instante y lo devolvía a
 * /admin/overview con la misma cuenta. "Cerrar sesión" no hacía nada
 * visible, y "probar otra cuenta" era imposible.
 *
 * Es la MISMA llamada que hace el SDK oficial por debajo de
 * KontroliaClient.logout() → supabase.auth.signOut(): POST /auth/v1/logout
 * con scope=global. Global a propósito: la sesión que hay que matar es la
 * del auth-server (otra distinta a la nuestra), y "local" solo tocaría la
 * de este token, que de todos modos se olvida al borrar la cookie. Es el
 * mismo alcance con el que cierran sesión las demás apps del ecosistema.
 *
 * Nunca lanza: si GoTrue no responde, la cookie se borra igual — quedarse
 * "adentro" por un error de red sería peor que un logout a medias.
 */
export async function revokeSession(cfg: KontroliaAuthConfig, accessToken: string): Promise<boolean> {
  try {
    const res = await fetch(`${cfg.supabaseUrl}/auth/v1/logout?scope=global`, {
      method: "POST",
      headers: { apikey: cfg.supabaseAnonKey, authorization: `Bearer ${accessToken}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

function bearerRequest(accessToken: string): Request {
  return new Request("https://admin.local/verify", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

/** Verifica el access_token contra el JWKS del proyecto (@kontrolia/auth/server). null si no es válido. */
export async function verifyAccessToken(cfg: KontroliaAuthConfig, accessToken: string) {
  try {
    return await verifyRequest(bearerRequest(accessToken), { supabaseUrl: cfg.supabaseUrl });
  } catch {
    return null;
  }
}

/**
 * Todas las organizaciones a las que pertenece quien manda este access_token
 * — lo que el selector del panel necesita para dibujarse. Vía RLS con el
 * propio token del usuario (@kontrolia/auth/server), sin service_role.
 */
export async function listMemberships(
  cfg: KontroliaAuthConfig,
  accessToken: string,
): Promise<KontroliaMembershipWithOrganization[]> {
  try {
    return await sdkListMemberships(bearerRequest(accessToken), {
      supabaseUrl: cfg.supabaseUrl,
      supabaseAnonKey: cfg.supabaseAnonKey,
    });
  } catch {
    return [];
  }
}

/**
 * Cambia la organización activa de la sesión. Reimplementa el mismo PATCH que
 * hace KontroliaClient.switchOrganization() (dist/client.js: un upsert a
 * kontrolia_auth.sessions_context vía PostgREST, con el propio access_token
 * del usuario — RLS scopea el upsert a su propia fila) porque ese método
 * vive en KontroliaClient, que es browser-only. El organization_id nuevo NO
 * aparece en el JWT hasta refrescar — por eso el caller debe llamar
 * refreshSession() después con el resultado de este upsert.
 */
export async function switchActiveOrganization(
  cfg: KontroliaAuthConfig,
  accessToken: string,
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/sessions_context`, {
    method: "POST",
    headers: {
      apikey: cfg.supabaseAnonKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "content-profile": "kontrolia_auth",
      prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      user_id: userId,
      active_organization_id: organizationId,
      updated_at: new Date().toISOString(),
    }),
  });
  return res.ok;
}

// ── Alta de cuentas e invitaciones (auth.kontrolia.io/public-signup.md) ──────
//
// Todo esto va contra el AUTH-SERVER (auth.kontrolia.io), no contra GoTrue:
// el alta por app y la API de administración viven ahí. Y las llamadas de
// administración van con el token DEL USUARIO en sesión, nunca con una API
// key — es el RLS del auth-server quien decide si esa persona es Owner/Admin
// de su organización.

export const DEFAULT_AUTH_SERVER_URL = "https://auth.kontrolia.io";
export const DEFAULT_APP_SLUG = "nodia-agents";

export function authServerUrl(env: Pick<Env, "KONTROLIA_AUTH_SERVER_URL">): string {
  return (env.KONTROLIA_AUTH_SERVER_URL ?? "").trim().replace(/\/$/, "") || DEFAULT_AUTH_SERVER_URL;
}

export function appSlug(env: Pick<Env, "KONTROLIA_APP_SLUG">): string {
  return (env.KONTROLIA_APP_SLUG ?? "").trim() || DEFAULT_APP_SLUG;
}

/**
 * A dónde manda "Crear cuenta": el alta por app del auth-server. Cada alta
 * crea SU PROPIA organización con solo esta app y deja a la persona como
 * Owner. `redirect_to` es a dónde vuelve tras confirmar el correo — ya con
 * sesión de GoTrue, así que el login OAuth de /admin/login completa solo.
 */
export function registerUrl(env: Pick<Env, "KONTROLIA_AUTH_SERVER_URL" | "KONTROLIA_APP_SLUG" | "DASHBOARD_BASE_URL">): string {
  const base = (env.DASHBOARD_BASE_URL ?? "").replace(/\/$/, "");
  const params = new URLSearchParams({ app: appSlug(env), redirect_to: `${base}/admin` });
  return `${authServerUrl(env)}/register?${params.toString()}`;
}

export interface KontroliaRole {
  id: string;
  name: string;
  slug: string;
  application_id: string | null;
}

export interface KontroliaInvitation {
  id: string;
  email: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  role: { name: string } | null;
}

async function authApi<T>(
  env: Pick<Env, "KONTROLIA_AUTH_SERVER_URL">,
  accessToken: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  try {
    const res = await fetch(`${authServerUrl(env)}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (res.status === 204) return { ok: true, data: undefined as T };
    const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok) return { ok: false, error: json?.error ?? `El auth-server respondió ${res.status}`, status: res.status };
    return { ok: true, data: json as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), status: 0 };
  }
}

/** Roles asignables en esta organización: los de la app ("Usuario de …", "Administrador de …") y los globales. */
export async function listRoles(env: Pick<Env, "KONTROLIA_AUTH_SERVER_URL">, accessToken: string, organizationId: string) {
  const r = await authApi<{ roles: KontroliaRole[] }>(env, accessToken, `/api/roles?organizationId=${encodeURIComponent(organizationId)}`);
  return r.ok ? { ok: true as const, roles: r.data.roles ?? [] } : r;
}

export async function listInvitations(env: Pick<Env, "KONTROLIA_AUTH_SERVER_URL">, accessToken: string, organizationId: string) {
  const r = await authApi<{ invitations: KontroliaInvitation[] }>(
    env,
    accessToken,
    `/api/invitations?organizationId=${encodeURIComponent(organizationId)}`,
  );
  return r.ok ? { ok: true as const, invitations: r.data.invitations ?? [] } : r;
}

/** Invita por correo con un rol. Si el auth-server tiene Resend, el correo sale solo (`emailSent`). */
export async function createInvitation(
  env: Pick<Env, "KONTROLIA_AUTH_SERVER_URL">,
  accessToken: string,
  input: { organizationId: string; email: string; roleId: string },
) {
  const r = await authApi<{ invitation: { id: string; token: string }; emailSent?: boolean }>(env, accessToken, "/api/invitations", {
    method: "POST",
    body: input,
  });
  return r.ok ? { ok: true as const, emailSent: r.data.emailSent === true } : r;
}

export async function deleteInvitation(env: Pick<Env, "KONTROLIA_AUTH_SERVER_URL">, accessToken: string, id: string) {
  const r = await authApi<void>(env, accessToken, `/api/invitations/${encodeURIComponent(id)}`, { method: "DELETE" });
  return r.ok ? { ok: true as const } : r;
}

// ── Organizaciones y miembros (la API de administración del auth-server) ─────

export interface KontroliaMember {
  membershipId: string;
  userId: string;
  email: string;
  name: string | null;
  status: "active" | "invited" | "suspended";
  createdAt: string;
  roles: Array<{ id: string; name: string; slug: string; application_id: string | null }>;
}

export async function listMembers(env: Pick<Env, "KONTROLIA_AUTH_SERVER_URL">, accessToken: string, organizationId: string) {
  const r = await authApi<{ members: KontroliaMember[] }>(
    env,
    accessToken,
    `/api/organization-members?organizationId=${encodeURIComponent(organizationId)}`,
  );
  return r.ok ? { ok: true as const, members: r.data.members ?? [] } : r;
}

/** Quita a alguien de la organización. El auth-server rechaza quitar al último Owner. */
export async function removeMember(env: Pick<Env, "KONTROLIA_AUTH_SERVER_URL">, accessToken: string, membershipId: string) {
  const r = await authApi<void>(env, accessToken, `/api/organization-members?membershipId=${encodeURIComponent(membershipId)}`, { method: "DELETE" });
  return r.ok ? { ok: true as const } : r;
}

export async function assignRole(env: Pick<Env, "KONTROLIA_AUTH_SERVER_URL">, accessToken: string, input: { membershipId: string; roleId: string }) {
  const r = await authApi<unknown>(env, accessToken, "/api/organization-members/roles", { method: "POST", body: input });
  return r.ok ? { ok: true as const } : r;
}

/** El id de esta app en KontrolIA (para habilitarla en una organización nueva). Se busca por slug en el catálogo. */
export async function findApplicationId(
  env: Pick<Env, "KONTROLIA_AUTH_SERVER_URL" | "KONTROLIA_APP_SLUG">,
  accessToken: string,
): Promise<string | null> {
  const r = await authApi<{ applications: Array<{ id: string; slug: string }> }>(env, accessToken, "/api/applications");
  if (!r.ok) return null;
  return r.data.applications?.find((a) => a.slug === appSlug(env))?.id ?? null;
}

function slugDe(nombre: string): string {
  const base = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "org";
  // Los slugs de organización son únicos en TODA la instancia: mismo sufijo
  // aleatorio que usa el alta pública para que dos "Mi negocio" no choquen.
  return `${base}-${crypto.randomUUID().replace(/-/g, "").slice(0, 6)}`;
}

/**
 * Crea una organización nueva con esta app habilitada y a quien la crea como
 * Owner + "Administrador de <app>" — lo mismo que deja el alta pública
 * (provision_self_service_tenant), pero para alguien que YA tiene cuenta y
 * quiere un segundo espacio: otra empresa, otro cliente de su agencia.
 *
 * Son cuatro llamadas porque el auth-server no expone ese aprovisionamiento
 * como un endpoint para usuarios existentes:
 *   1. POST /api/organizations           → la org; el trigger enrola al creador como Owner.
 *   2. POST /api/organizations/:id/applications → habilita la app; el trigger crea
 *      el rol "Administrador de <app>" (grants_all_permissions).
 *   3. GET roles + GET miembros           → encontrar ese rol y mi membresía.
 *   4. POST /api/organization-members/roles → asignármelo. Sin esto tendría
 *      autoridad de organización (invitar, comprar) pero cero permisos DEL
 *      PANEL al entrar, aun con plan.
 * Si 2–4 fallan, la org ya existe: se devuelve con aviso, no se deja a medias
 * sin decirlo.
 */
export async function createOrganization(
  env: Pick<Env, "KONTROLIA_AUTH_SERVER_URL" | "KONTROLIA_APP_SLUG">,
  accessToken: string,
  userId: string,
  nombre: string,
): Promise<{ ok: true; organizationId: string; aviso?: string } | { ok: false; error: string }> {
  const creada = await authApi<{ organization: { id: string; name: string; slug: string } }>(env, accessToken, "/api/organizations", {
    method: "POST",
    body: { name: nombre.trim(), slug: slugDe(nombre) },
  });
  if (!creada.ok) return { ok: false, error: creada.error };
  const organizationId = creada.data.organization.id;

  const applicationId = await findApplicationId(env, accessToken);
  if (!applicationId) return { ok: true, organizationId, aviso: "La organización se creó, pero no se pudo habilitar Nodia Agents en ella." };

  const habilitada = await authApi<unknown>(env, accessToken, `/api/organizations/${encodeURIComponent(organizationId)}/applications`, {
    method: "POST",
    body: { applicationId },
  });
  if (!habilitada.ok) return { ok: true, organizationId, aviso: `La organización se creó, pero no se pudo habilitar Nodia Agents: ${habilitada.error}` };

  const [roles, miembros] = await Promise.all([listRoles(env, accessToken, organizationId), listMembers(env, accessToken, organizationId)]);
  const rolAdmin = roles.ok ? roles.roles.find((r) => r.application_id === applicationId && /^administrador de /i.test(r.name)) : undefined;
  const miMembresia = miembros.ok ? miembros.members.find((m) => m.userId === userId) : undefined;
  if (!rolAdmin || !miMembresia) {
    return { ok: true, organizationId, aviso: "La organización se creó, pero no se te pudo asignar el rol de administrador de Nodia Agents. Asígnalo desde panel.kontrolia.io." };
  }
  const asignado = await assignRole(env, accessToken, { membershipId: miMembresia.membershipId, roleId: rolAdmin.id });
  if (!asignado.ok) return { ok: true, organizationId, aviso: `La organización se creó, pero no se te pudo asignar el rol de administrador: ${asignado.error}` };
  return { ok: true, organizationId };
}
