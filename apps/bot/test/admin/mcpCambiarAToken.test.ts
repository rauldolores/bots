/**
 * Pasar un conector MCP de OAuth a token, sin perderlo.
 *
 * Con OAuth, el acceso del bot cuelga de la sesión de quien lo autorizó, y
 * cerrar sesión en el ecosistema es GLOBAL: se lleva esa autorización. Un bot
 * pasó así un mes sin su CRM (2026-09-24 → 2026-10-27). Con un token de la
 * organización la conexión no depende de nadie.
 *
 * Lo que importa probar: que el token quede en el MISMO secreto (el juego de
 * tokens de OAuth que había ya no sirve), que no quede rastro de OAuth —si
 * authMode siguiera en "oauth", la conexión seguiría yendo por OAuth— y que
 * se conserve lo que el dueño ya había configurado.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { BotConnectorsRepo } from "../../src/db/botConnectors";
import { createSecret, readSecret } from "../../src/db/vault";
import { saveMcpPurpose, renderMcpEditModal } from "../../src/admin/views/conexiones";
import type { Env } from "../../src/env";

const URL_MCP = "https://app.vinqulia.com/api/mcp";
let db: Db;
let env: Env;
let secretRef: string;

beforeEach(async () => {
  db = await createTestDb();
  env = { DB: db.driver } as unknown as Env;
  secretRef = await createSecret(
    db,
    JSON.stringify({ access_token: "a", refresh_token: "muerto" }),
    `mcp-test-${crypto.randomUUID()}`,
  );
  await new BotConnectorsRepo(db).upsert({
    botId: TEST_BOT_ID,
    category: "mcp",
    provider: "mcp-vinqulia",
    name: "Vinqulia",
    secretRef,
    config: {
      url: URL_MCP,
      authMode: "oauth",
      purpose: "Consultar el historial de un cliente.",
      oauthClientInfo: '{"client_id":"abc"}',
      oauthServerInfo: '{"issuer":"https://auth.test"}',
      oauthExpiresAt: "1789000000000",
      oauthRefreshedAt: "1788990000000",
      mcpLastError: "El servidor ya no acepta la renovación",
      mcpLastErrorAt: "1789600000000",
      mcpToolsCachedAt: "1789500000000",
    },
  });
});

const form = (campos: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};
const leer = () => new BotConnectorsRepo(db).getByBotAndProvider(TEST_BOT_ID, "mcp-vinqulia");

describe("el modal de un conector OAuth ofrece pasarlo a token", () => {
  it("trae el campo y explica por qué", async () => {
    const html = await renderMcpEditModal(env, TEST_BOT_ID, "mcp-vinqulia");
    expect(html).toContain('name="token"');
    expect(html).toContain("Cambiar a token");
    expect(html).toContain("Claves de API");
  });
});

describe("saveMcpPurpose con un token", () => {
  it("deja el token en el mismo secreto y quita todo rastro de OAuth", async () => {
    await saveMcpPurpose(
      env,
      TEST_BOT_ID,
      "mcp-vinqulia",
      form({ url: URL_MCP, purpose: "Consultar el historial de un cliente.", token: "vnq_nuevo123" }),
    );
    const c = await leer();
    expect(c?.secret_ref).toBe(secretRef);
    expect(await readSecret(db, secretRef)).toBe("vnq_nuevo123");
    expect(c?.config.authMode).toBe("");
    expect(c?.config.oauthClientInfo).toBe("");
    expect(c?.config.oauthExpiresAt).toBe("");
    expect(c?.config.mcpLastError).toBe("");
  });

  it("conserva el nombre, la dirección, el propósito y el catálogo de herramientas en caché", async () => {
    await saveMcpPurpose(
      env,
      TEST_BOT_ID,
      "mcp-vinqulia",
      form({ url: URL_MCP, purpose: "Consultar el historial de un cliente.", token: "vnq_nuevo123" }),
    );
    const c = await leer();
    expect(c?.name).toBe("Vinqulia");
    expect(c?.config.url).toBe(URL_MCP);
    expect(c?.config.purpose).toBe("Consultar el historial de un cliente.");
    expect(c?.config.mcpToolsCachedAt).toBe("1789500000000");
  });

  it("ya no lo ve la renovación de OAuth del tick", async () => {
    await saveMcpPurpose(env, TEST_BOT_ID, "mcp-vinqulia", form({ url: URL_MCP, purpose: "x", token: "vnq_nuevo123" }));
    const oauth = await new BotConnectorsRepo(db).listOAuthMcp();
    expect(oauth.find((c) => c.provider === "mcp-vinqulia")).toBeUndefined();
  });

  it("sin token, no toca la autenticación", async () => {
    await saveMcpPurpose(env, TEST_BOT_ID, "mcp-vinqulia", form({ url: URL_MCP, purpose: "Otro propósito." }));
    const c = await leer();
    expect(c?.config.authMode).toBe("oauth");
    expect(await readSecret(db, secretRef)).toContain("muerto");
  });

  it("un token con espacios se rechaza sin guardar nada", async () => {
    const html = await saveMcpPurpose(env, TEST_BOT_ID, "mcp-vinqulia", form({ url: URL_MCP, purpose: "x", token: "vnq_ abc" }));
    expect(html).toContain("Token inválido");
    expect((await leer())?.config.authMode).toBe("oauth");
  });
});
