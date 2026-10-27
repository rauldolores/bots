/**
 * El caso del dueño, textual (2026-09-09): "ya van varias veces que no
 * renueva automáticamente el token... tengo que reconectarlo manualmente a
 * cada rato", junto al mensaje "[mcpTools] Vinqulia no respondió en 4000ms".
 *
 * Las dos frases son el mismo problema visto por sus dos puntas: refrescar
 * corría dentro del turno del cliente con 4s de presupuesto —que no alcanzan
 * para descubrimiento + token endpoint— y al vencer el plazo el trabajo se
 * abandonaba con el refresh_token ya rotado del lado del proveedor y el nuevo
 * sin guardar. A partir de ahí, ningún reintento podía recuperarlo.
 *
 * `auth()` de @ai-sdk/mcp va mockeado: lo que se prueba aquí es que el token
 * nuevo SE GUARDA y cuándo se decide renovar, no el protocolo OAuth.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { BotConnectorsRepo } from "../../src/db/botConnectors";
import type { Env } from "../../src/env";

const authMock = vi.fn();
vi.mock("@ai-sdk/mcp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ai-sdk/mcp")>();
  return { ...actual, auth: (...args: unknown[]) => authMock(...args) };
});

const readSecretMock = vi.fn();
const updateSecretMock = vi.fn();
vi.mock("../../src/db/vault", () => ({
  readSecret: (...args: unknown[]) => readSecretMock(...args),
  updateSecret: (...args: unknown[]) => updateSecretMock(...args),
  createSecret: vi.fn(),
  deleteSecret: vi.fn(),
}));

// El aviso al dueño sale por su canal (Telegram, correo…): aquí solo se cuenta.
const notifyOwnerMock = vi.fn();
vi.mock("../../src/tools/handoffHuman", () => ({
  notifyOwner: (...args: unknown[]) => notifyOwnerMock(...args),
}));

const { tocaRenovar, renovarConectorMcp, refrescarTokensMcp, MOTIVO_SIN_AUTORIZACION } = await import(
  "../../src/connectors/mcpRefresh"
);

const SECRET_REF = "11111111-2222-3333-4444-555555555555";
const HORA = 3600_000;

let db: Db;
let env: Env;

/** Deja un conector MCP por OAuth listo, con el vencimiento que se le indique. */
async function conectorMcp(config: Record<string, string> = {}) {
  await new BotConnectorsRepo(db).upsert({
    botId: TEST_BOT_ID,
    category: "mcp",
    provider: "vinqulia-mcp",
    name: "Vinqulia",
    secretRef: SECRET_REF,
    config: { url: "https://mcp.miempresa.com", authMode: "oauth", ...config },
  });
  return (await new BotConnectorsRepo(db).getByBotAndProvider(TEST_BOT_ID, "vinqulia-mcp"))!;
}

beforeEach(async () => {
  db = await createTestDb();
  env = { DB: db.driver, DASHBOARD_BASE_URL: "https://bot.test" } as unknown as Env;
  authMock.mockReset();
  readSecretMock.mockReset().mockResolvedValue(
    JSON.stringify({ access_token: "viejo", refresh_token: "rt-viejo", expires_in: 3600 }),
  );
  updateSecretMock.mockReset().mockResolvedValue(undefined);
  notifyOwnerMock.mockReset().mockResolvedValue(undefined);
});

describe("tocaRenovar", () => {
  it("no toca mientras falte mucho para el vencimiento", () => {
    expect(tocaRenovar({ oauthExpiresAt: String(Date.now() + HORA) })).toBe(false);
  });

  it("toca dentro del margen de anticipación, ANTES de que muera", () => {
    // Cinco minutos por delante: el token todavía sirve. Ésa es justamente la
    // ventana donde hay que renovar — esperar a que falle es lo que dejaba al
    // cliente esperando mientras se intentaba en pleno turno.
    expect(tocaRenovar({ oauthExpiresAt: String(Date.now() + 5 * 60_000) })).toBe(true);
  });

  it("toca si ya venció", () => {
    expect(tocaRenovar({ oauthExpiresAt: String(Date.now() - HORA) })).toBe(true);
  });

  it("un conector sin fecha guardada se revisa igual", () => {
    // Son los conectados antes de que se registrara el vencimiento. No saber
    // cuándo vencen no es razón para dejarlos morir.
    expect(tocaRenovar({})).toBe(true);
    expect(tocaRenovar({ oauthExpiresAt: "no-es-un-numero" })).toBe(true);
  });

  it("sin fecha pero recién renovado, no se vuelve a intentar en cada tick", () => {
    expect(tocaRenovar({ oauthRefreshedAt: String(Date.now() - 60_000) })).toBe(false);
  });
});

describe("renovarConectorMcp", () => {
  it("guarda el juego de tokens nuevo — perder un refresh_token rotado no se arregla reintentando", async () => {
    const c = await conectorMcp({ oauthExpiresAt: String(Date.now() - 1) });
    authMock.mockImplementation(async (provider: any) => {
      // Así se comporta el SDK: escribe los tokens nuevos en el provider.
      provider.saveTokens({ access_token: "nuevo", refresh_token: "rt-nuevo", expires_in: 3600 });
      return "AUTHORIZED";
    });

    const r = await renovarConectorMcp(env, db, c);

    expect(r.estado).toBe("renovado");
    expect(updateSecretMock).toHaveBeenCalledWith(expect.anything(), SECRET_REF, expect.stringContaining("rt-nuevo"));
  });

  it("deja apuntado el nuevo vencimiento, para no volver a renovar en el siguiente tick", async () => {
    const c = await conectorMcp({ oauthExpiresAt: String(Date.now() - 1) });
    authMock.mockImplementation(async (provider: any) => {
      provider.saveTokens({ access_token: "nuevo", refresh_token: "rt-nuevo", expires_in: 3600 });
      return "AUTHORIZED";
    });

    await renovarConectorMcp(env, db, c);

    const row = await new BotConnectorsRepo(db).getByBotAndProvider(TEST_BOT_ID, "vinqulia-mcp");
    expect(Number(row!.config.oauthExpiresAt)).toBeGreaterThan(Date.now() + 50 * 60_000);
    expect(tocaRenovar(row!.config)).toBe(false);
  });

  it("si el proveedor rotó el token pero pide volver a autorizar, el token nuevo SE GUARDA igual", async () => {
    // Éste es el escape exacto que dejaba el acceso perdido: el token endpoint
    // ya contestó —el viejo quedó consumido— y aun así el resultado final no
    // fue "AUTHORIZED". Tirar ese cambio deja Vault con una credencial muerta.
    const c = await conectorMcp({ oauthExpiresAt: String(Date.now() - 1) });
    authMock.mockImplementation(async (provider: any) => {
      provider.saveTokens({ access_token: "nuevo", refresh_token: "rt-nuevo", expires_in: 3600 });
      return "REDIRECT";
    });

    const r = await renovarConectorMcp(env, db, c);

    expect(r.estado).toBe("requiere_autorizacion");
    expect(updateSecretMock).toHaveBeenCalledWith(expect.anything(), SECRET_REF, expect.stringContaining("rt-nuevo"));
  });

  it("sin refresh_token guardado, no intenta nada: eso solo lo arregla el dueño reconectando", async () => {
    const c = await conectorMcp();
    readSecretMock.mockResolvedValue(JSON.stringify({ access_token: "solo-acceso" }));

    const r = await renovarConectorMcp(env, db, c);

    expect(r.estado).toBe("requiere_autorizacion");
    expect(authMock).not.toHaveBeenCalled();
  });

  it("si falla, lo deja anotado para que el panel lo muestre y no se reintente en cada tick", async () => {
    const c = await conectorMcp({ oauthExpiresAt: String(Date.now() - 1) });
    authMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const r = await renovarConectorMcp(env, db, c);

    expect(r.estado).toBe("fallo");
    const row = await new BotConnectorsRepo(db).getByBotAndProvider(TEST_BOT_ID, "vinqulia-mcp");
    expect(row!.config.mcpLastError).toContain("ECONNREFUSED");
    expect(Number(row!.config.mcpLastErrorAt)).toBeGreaterThan(0);
  });

  it("al renovar bien, limpia el aviso de caído que había quedado", async () => {
    const c = await conectorMcp({
      oauthExpiresAt: String(Date.now() - 1),
      mcpLastError: "Vinqulia no respondió en 4000ms",
      mcpLastErrorAt: String(Date.now() - 10 * 60_000),
    });
    authMock.mockImplementation(async (provider: any) => {
      provider.saveTokens({ access_token: "nuevo", refresh_token: "rt-nuevo", expires_in: 3600 });
      return "AUTHORIZED";
    });

    await renovarConectorMcp(env, db, c);

    const row = await new BotConnectorsRepo(db).getByBotAndProvider(TEST_BOT_ID, "vinqulia-mcp");
    expect(row!.config.mcpLastError).toBe("");
  });
});

describe("refrescarTokensMcp — la pasada del tick", () => {
  it("no toca la red cuando a nadie le falta poco para vencer", async () => {
    await conectorMcp({ oauthExpiresAt: String(Date.now() + 2 * HORA) });
    const resumen = await refrescarTokensMcp(env);
    expect(resumen.revisados).toBe(0);
    expect(authMock).not.toHaveBeenCalled();
  });

  it("renueva al que está por vencer", async () => {
    await conectorMcp({ oauthExpiresAt: String(Date.now() + 60_000) });
    authMock.mockImplementation(async (provider: any) => {
      provider.saveTokens({ access_token: "nuevo", refresh_token: "rt-nuevo", expires_in: 3600 });
      return "AUTHORIZED";
    });

    const resumen = await refrescarTokensMcp(env);

    expect(resumen.renovados).toBe(1);
    expect(updateSecretMock).toHaveBeenCalled();
  });

  it("un conector que falló hace un minuto no se reintenta en el siguiente tick", async () => {
    await conectorMcp({ oauthExpiresAt: String(Date.now() - 1), mcpLastErrorAt: String(Date.now() - 60_000) });
    const resumen = await refrescarTokensMcp(env);
    expect(resumen.revisados).toBe(0);
    expect(authMock).not.toHaveBeenCalled();
  });

  it("los conectores MCP de token estático ni se miran — no hay nada que renovar", async () => {
    await new BotConnectorsRepo(db).upsert({
      botId: TEST_BOT_ID,
      category: "mcp",
      provider: "otro-mcp",
      secretRef: SECRET_REF,
      config: { url: "https://otro.com" },
    });
    const resumen = await refrescarTokensMcp(env);
    expect(resumen.revisados).toBe(0);
  });
});

// Lo que pasó del 2026-09-24 al 2026-10-27: cerrar sesión en el ecosistema es
// GLOBAL y se llevó la sesión de la que colgaba la autorización del MCP. Desde
// ahí cada renovación respondía "Refresh Token Not Found" — y como eso no se
// anotaba en ningún lado, el panel decía CONECTADO y nadie se enteró en un mes.
describe("renovarConectorMcp — cuando el proveedor ya no acepta la renovación", () => {
  it("lo deja escrito: el panel lo muestra y el turno deja de ofrecer esas herramientas", async () => {
    const c = await conectorMcp({ oauthExpiresAt: String(Date.now() - 1) });
    authMock.mockResolvedValue("REDIRECT");

    const r = await renovarConectorMcp(env, db, c);

    expect(r.estado).toBe("requiere_autorizacion");
    const row = await new BotConnectorsRepo(db).getByBotAndProvider(TEST_BOT_ID, "vinqulia-mcp");
    expect(row!.config.mcpLastError).toBe(MOTIVO_SIN_AUTORIZACION);
    expect(Number(row!.config.mcpLastErrorAt)).toBeGreaterThan(0);
  });

  it("le avisa al dueño, con a dónde ir para arreglarlo", async () => {
    const c = await conectorMcp({ oauthExpiresAt: String(Date.now() - 1) });
    authMock.mockResolvedValue("REDIRECT");

    await renovarConectorMcp(env, db, c);

    expect(notifyOwnerMock).toHaveBeenCalledTimes(1);
    const [, aviso, botId] = notifyOwnerMock.mock.calls[0];
    expect(botId).toBe(TEST_BOT_ID);
    expect(aviso.reason).toContain("Vinqulia");
    expect(aviso.ruta).toBe("/admin/conexiones");
    expect(aviso.summary).toContain("token");
  });

  it("no le repite el aviso cada 5 minutos: una vez al día como mucho", async () => {
    authMock.mockResolvedValue("REDIRECT");
    await renovarConectorMcp(env, db, await conectorMcp({ oauthExpiresAt: String(Date.now() - 1) }));
    const repo = new BotConnectorsRepo(db);
    await renovarConectorMcp(env, db, (await repo.getByBotAndProvider(TEST_BOT_ID, "vinqulia-mcp"))!);

    expect(notifyOwnerMock).toHaveBeenCalledTimes(1);
  });

  it("sin refresh_token también queda escrito (y avisado)", async () => {
    const c = await conectorMcp();
    readSecretMock.mockResolvedValue(JSON.stringify({ access_token: "solo-acceso" }));

    await renovarConectorMcp(env, db, c);

    const row = await new BotConnectorsRepo(db).getByBotAndProvider(TEST_BOT_ID, "vinqulia-mcp");
    expect(row!.config.mcpLastError).toBe(MOTIVO_SIN_AUTORIZACION);
    expect(notifyOwnerMock).toHaveBeenCalledTimes(1);
  });

  it("si el aviso falla, la renovación no truena por eso", async () => {
    const c = await conectorMcp({ oauthExpiresAt: String(Date.now() - 1) });
    authMock.mockResolvedValue("REDIRECT");
    notifyOwnerMock.mockRejectedValue(new Error("Telegram caído"));

    const r = await renovarConectorMcp(env, db, c);

    expect(r.estado).toBe("requiere_autorizacion");
  });
});
