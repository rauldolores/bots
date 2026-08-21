import { describe, it, expect, vi } from "vitest";
import { ensureFreshToken, parseTokenSet } from "../../src/connectors/oauthCreds";
import type { BotConnector } from "../../src/db/botConnectors";

const readSecretMock = vi.fn();
const updateSecretMock = vi.fn();
vi.mock("../../src/db/vault", () => ({
  readSecret: (...args: unknown[]) => readSecretMock(...args),
  updateSecret: (...args: unknown[]) => updateSecretMock(...args),
}));

function connector(secretRef: string | null): BotConnector {
  return {
    id: "1",
    bot_id: "bot-1",
    category: "calendar",
    provider: "google-calendar",
    name: "Google Calendar",
    secret_ref: secretRef,
    config: {},
    enabled: true,
    created_at: Date.now(),
  };
}

describe("parseTokenSet", () => {
  it("acepta un JSON con access_token y refresh_token", () => {
    expect(parseTokenSet(JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: 1 }))).toEqual({
      access_token: "a",
      refresh_token: "r",
      expires_at: 1,
    });
  });

  it("rechaza JSON incompleto o inválido", () => {
    expect(parseTokenSet("no es json")).toBeNull();
    expect(parseTokenSet(JSON.stringify({ access_token: "a" }))).toBeNull();
  });
});

describe("ensureFreshToken", () => {
  it("sin secret_ref, devuelve null sin llamar a Vault", async () => {
    expect(await ensureFreshToken(null as any, connector(null), vi.fn())).toBeNull();
  });

  it("token todavía vigente: lo devuelve tal cual, sin refrescar", async () => {
    readSecretMock.mockResolvedValue(JSON.stringify({ access_token: "vigente", refresh_token: "r", expires_at: Date.now() + 60 * 60_000 }));
    const refresh = vi.fn();
    const token = await ensureFreshToken(null as any, connector("sec-1"), refresh);
    expect(token).toBe("vigente");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("token por vencer (dentro del margen): refresca y guarda el nuevo juego en Vault", async () => {
    readSecretMock.mockResolvedValue(JSON.stringify({ access_token: "viejo", refresh_token: "r-original", expires_at: Date.now() + 60_000 }));
    const refresh = vi.fn(async (rt: string) => ({ access_token: "nuevo", refresh_token: rt, expires_at: Date.now() + 3600_000 }));
    const token = await ensureFreshToken(null as any, connector("sec-1"), refresh);
    expect(token).toBe("nuevo");
    expect(refresh).toHaveBeenCalledWith("r-original");
    expect(updateSecretMock).toHaveBeenCalledWith(null, "sec-1", expect.stringContaining("nuevo"));
  });

  it("si el refresh falla, devuelve null sin lanzar", async () => {
    readSecretMock.mockResolvedValue(JSON.stringify({ access_token: "viejo", refresh_token: "r", expires_at: Date.now() - 1000 }));
    const refresh = vi.fn(async () => {
      throw new Error("refresh_token revocado");
    });
    expect(await ensureFreshToken(null as any, connector("sec-1"), refresh)).toBeNull();
  });

  it("secreto vacío/corrupto en Vault: devuelve null", async () => {
    readSecretMock.mockResolvedValue("no es json");
    expect(await ensureFreshToken(null as any, connector("sec-1"), vi.fn())).toBeNull();
  });
});
