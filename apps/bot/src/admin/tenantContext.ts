// F5 de docs/multitenancy.md: a qué bot pertenece ESTE request del panel.
//
// Antes de esto, todo el panel llamaba a resolveBotId(db) (src/tenant.ts),
// que exige que haya EXACTAMENTE un bot en toda la tabla — falla fuerte con
// 2+. Eso ya no alcanza: con una sesión de KontrolIA Auth, el usuario puede
// pertenecer a varias organizaciones y cada una puede tener varios bots.
//
// Con sesión de KontrolIA: el bot tiene que pertenecer a la organización
// ACTIVA (el organization_id del JWT — ver switchActiveOrganization). Cuál
// de los bots de esa organización es "el actual" se recuerda en una cookie;
// sin cookie válida, se usa el primero (por antigüedad) y se dejan la cookie
// apuntando ahí, para que quedarse quieto sea predecible.
//
// Sin sesión de KontrolIA (Basic Auth, o KontrolIA sin configurar): con UN
// bot, cero cambio de comportamiento. Con 2+, antes se llamaba a
// resolveBotId() y TODO el panel respondía 500 — y desde que se pueden crear
// bots desde el panel, tener dos dejó de ser un caso raro. Ahora se recuerda
// el elegido en la misma cookie, y el header muestra un selector para
// cambiarlo: adivinar en silencio sería peor que fallar, pero elegir de forma
// visible y reversible no es adivinar.
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Env } from "../env";
import type { Db } from "../db/client";
import { BotsRepo } from "../db/bots";
import { resolveBotId } from "../tenant";
import type { KontroliaTokenClaims } from "@kontrolia/shared";

export const BOT_COOKIE = "nodia_current_bot";

export interface AdminTenant {
  /** null cuando no hay sesión de KontrolIA (Basic Auth / no configurado). */
  organizationId: string | null;
  botId: string;
}

/** Organización real (con sesión válida) pero sin ningún bot todavía — no es un error de programación. */
export class NoBotsInOrganizationError extends Error {
  constructor(public readonly organizationId: string) {
    super(`La organización ${organizationId} todavía no tiene ningún bot.`);
  }
}

/** Compartido con routes.ts — el mismo tipo, no uno estructuralmente igual, para que Context<> encaje. */
export type AdminBindings = {
  Bindings: Env;
  Variables: { botId: string; kontroliaOrgId: string | null; kontroliaClaims?: KontroliaTokenClaims };
};

type HonoContext = Context<AdminBindings>;

/** Un año: el bot elegido debe sobrevivir a cerrar el navegador. */
export function setBotCookie(c: HonoContext, botId: string): void {
  setCookie(c, BOT_COOKIE, botId, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: 60 * 60 * 24 * 365,
  });
}

/**
 * Elige entre una lista ya acotada: la cookie si sigue siendo válida, si no el
 * primero (más antiguo — `listAll`/`listByOrganization` ordenan por created_at,
 * así que "el primero" es estable entre requests y no cambia solo).
 */
function pickCurrent(c: HonoContext, bots: { id: string }[]): string {
  const cookieBotId = getCookie(c, BOT_COOKIE);
  const current = bots.find((b) => b.id === cookieBotId) ?? bots[0];
  if (current.id !== cookieBotId) setBotCookie(c, current.id);
  return current.id;
}

export async function resolveAdminTenant(
  c: HonoContext,
  db: Db,
  organizationId: string | null,
): Promise<AdminTenant> {
  if (!organizationId) {
    return { organizationId: null, botId: await resolveLocalBotId(c, db) };
  }
  const bots = await new BotsRepo(db).listByOrganization(organizationId);
  if (bots.length === 0) {
    throw new NoBotsInOrganizationError(organizationId);
  }
  return { organizationId, botId: pickCurrent(c, bots) };
}

/**
 * Basic Auth: quien entra tiene la contraseña del DESPLIEGUE, así que ya ve
 * todos los bots — aquí no hay frontera de datos que cuidar entre
 * organizaciones (eso solo aplica con sesión de KontrolIA). Lo único en juego
 * es no mostrar el bot equivocado sin avisar, y de eso se encarga el selector
 * del header.
 *
 * Con cero bots se sigue delegando en resolveBotId(): eso no es una
 * ambigüedad, es una instalación a medias, y su mensaje ya lo explica.
 */
async function resolveLocalBotId(c: HonoContext, db: Db): Promise<string> {
  const bots = await new BotsRepo(db).listAll();
  if (bots.length === 0) return resolveBotId(db);
  if (bots.length === 1) return bots[0].id;
  return pickCurrent(c, bots);
}
