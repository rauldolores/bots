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
import { verifyRequest } from "@kontrolia/auth/server";
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

export async function refreshSession(
  cfg: KontroliaAuthConfig,
  refreshToken: string,
): Promise<KontroliaSession | null> {
  const res = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: cfg.supabaseAnonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) return null;
  return toSession((await res.json()) as TokenResponse);
}

/** Verifica el access_token contra el JWKS del proyecto (@kontrolia/auth/server). null si no es válido. */
export async function verifyAccessToken(cfg: KontroliaAuthConfig, accessToken: string) {
  try {
    const fakeRequest = new Request("https://admin.local/verify", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    return await verifyRequest(fakeRequest, { supabaseUrl: cfg.supabaseUrl });
  } catch {
    return null;
  }
}
