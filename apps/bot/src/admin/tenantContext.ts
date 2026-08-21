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
// Sin sesión de KontrolIA (Basic Auth, o KontrolIA sin configurar): cero
// cambio de comportamiento — resolveBotId(db) de siempre.
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

export async function resolveAdminTenant(
  c: HonoContext,
  db: Db,
  organizationId: string | null,
): Promise<AdminTenant> {
  if (!organizationId) {
    return { organizationId: null, botId: await resolveBotId(db) };
  }
  const bots = await new BotsRepo(db).listByOrganization(organizationId);
  if (bots.length === 0) {
    throw new NoBotsInOrganizationError(organizationId);
  }
  const cookieBotId = getCookie(c, BOT_COOKIE);
  const current = bots.find((b) => b.id === cookieBotId) ?? bots[0];
  if (current.id !== cookieBotId) {
    setCookie(c, BOT_COOKIE, current.id, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return { organizationId, botId: current.id };
}
