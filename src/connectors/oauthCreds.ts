import type { Db } from "../db/client";
import type { BotConnector } from "../db/botConnectors";
import { readSecret, updateSecret } from "../db/vault";

/** Lo que guarda Vault para un conector OAuth — JSON, no un token plano. */
export interface OAuthTokenSet {
  access_token: string;
  refresh_token: string;
  /** epoch ms. */
  expires_at: number;
}

export function parseTokenSet(raw: string): OAuthTokenSet | null {
  try {
    const t = JSON.parse(raw);
    return t && typeof t.access_token === "string" && typeof t.refresh_token === "string" ? t : null;
  } catch {
    return null;
  }
}

/** Margen antes de que venza para refrescar de una vez, no justo cuando ya expiró. */
const REFRESH_MARGIN_MS = 2 * 60_000;

/**
 * Devuelve un access_token vigente — lo refresca primero si está por vencer,
 * y guarda el nuevo juego de tokens en Vault (Vault es la única copia; sin
 * refresh_token guardado, se pierde el acceso hasta reconectar).
 */
export async function ensureFreshToken(
  db: Db,
  connector: BotConnector,
  refresh: (refreshToken: string) => Promise<OAuthTokenSet>,
): Promise<string | null> {
  if (!connector.secret_ref) return null;
  const raw = await readSecret(db, connector.secret_ref);
  const tokens = raw ? parseTokenSet(raw) : null;
  if (!tokens) return null;
  if (Date.now() < tokens.expires_at - REFRESH_MARGIN_MS) return tokens.access_token;

  try {
    const fresh = await refresh(tokens.refresh_token);
    await updateSecret(db, connector.secret_ref, JSON.stringify(fresh));
    return fresh.access_token;
  } catch (e) {
    console.error(`[oauth] refrescar el token de ${connector.name ?? connector.provider} falló:`, e);
    return null;
  }
}
