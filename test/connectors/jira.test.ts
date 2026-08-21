import { describe, it, expect, vi } from "vitest";
import { jiraAuthorizeUrl, jiraExchangeCode, refreshJiraToken, jiraConnector } from "../../src/connectors/tickets/jira";
import type { Env } from "../../src/env";

const envOk = { JIRA_CLIENT_ID: "cid", JIRA_CLIENT_SECRET: "csecret" } as unknown as Env;

describe("jiraAuthorizeUrl", () => {
  it("arma la URL con audience=api.atlassian.com y el scope offline_access", () => {
    const url = jiraAuthorizeUrl(envOk, "https://bot.test/callback", "the-state");
    expect(url).toContain("audience=api.atlassian.com");
    expect(url).toContain(encodeURIComponent("offline_access"));
    expect(url).toContain("state=the-state");
  });

  it("sin client_id configurado, devuelve null", () => {
    expect(jiraAuthorizeUrl({} as Env, "https://x", "s")).toBeNull();
  });
});

describe("jiraExchangeCode", () => {
  it("intercambia el código, y resuelve el cloudId/siteUrl del sitio accesible", async () => {
    global.fetch = vi.fn(async (url: any) => {
      if (url === "https://auth.atlassian.com/oauth/token") {
        return new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600 }), { status: 200 });
      }
      if (url === "https://api.atlassian.com/oauth/token/accessible-resources") {
        return new Response(JSON.stringify([{ id: "cloud-123", url: "https://miempresa.atlassian.net" }]), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as any;

    const result = await jiraExchangeCode(envOk, "https://bot.test/callback", "the-code");
    expect(result.tokens.access_token).toBe("at");
    expect(result.cloudId).toBe("cloud-123");
    expect(result.siteUrl).toBe("https://miempresa.atlassian.net");
  });

  it("sin sitios accesibles, lanza un error claro", async () => {
    global.fetch = vi.fn(async (url: any) => {
      if (url === "https://auth.atlassian.com/oauth/token") {
        return new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }) as any;
    await expect(jiraExchangeCode(envOk, "https://bot.test/callback", "code")).rejects.toThrow(/ningún sitio/);
  });

  it("sin refresh_token, lanza (falta offline_access)", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), { status: 200 })) as any;
    await expect(jiraExchangeCode(envOk, "https://bot.test/callback", "code")).rejects.toThrow(/refresh_token/);
  });
});

describe("refreshJiraToken", () => {
  it("usa el refresh_token rotado si Atlassian manda uno nuevo", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "at-nuevo", refresh_token: "rt-rotado", expires_in: 3600 }), { status: 200 }),
    ) as any;
    const tokens = await refreshJiraToken(envOk, "rt-original");
    expect(tokens.refresh_token).toBe("rt-rotado");
  });

  it("si no rota, conserva el original", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: "at-nuevo", expires_in: 3600 }), { status: 200 })) as any;
    const tokens = await refreshJiraToken(envOk, "rt-original");
    expect(tokens.refresh_token).toBe("rt-original");
  });
});

const creds = { apiKey: "at-fake", config: { cloudId: "cloud-123", projectKey: "SUP", siteUrl: "https://miempresa.atlassian.net" } };

describe("jiraConnector.pushTicket", () => {
  it("crea la incidencia en el proyecto configurado, con descripción en formato ADF", async () => {
    global.fetch = vi.fn(async (url: any, init: any) => {
      expect(url).toBe("https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/issue");
      const body = JSON.parse(init.body);
      expect(body.fields.project).toEqual({ key: "SUP" });
      expect(body.fields.description.type).toBe("doc");
      return new Response(JSON.stringify({ key: "SUP-42" }), { status: 201 });
    }) as any;
    const result = await jiraConnector.pushTicket(creds, { category: "billing", summary: "El cliente no puede pagar" });
    expect(result).toEqual({ ok: true, externalId: "SUP-42" });
  });

  it("sin projectKey configurado, error claro sin llamar a la API", async () => {
    global.fetch = vi.fn() as any;
    const result = await jiraConnector.pushTicket(
      { apiKey: "at-fake", config: { cloudId: "cloud-123" } },
      { category: "other", summary: "x" },
    );
    expect(result.ok).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("jiraConnector.listOpen", () => {
  it("filtra por proyecto y resolution=Unresolved, y arma la URL del navegador", async () => {
    global.fetch = vi.fn(async (url: any) => {
      expect(url).toContain("project%20%3D%20SUP");
      return new Response(
        JSON.stringify({ issues: [{ key: "SUP-1", fields: { summary: "Algo", status: { name: "To Do" }, created: "2026-08-20T00:00:00Z" } }] }),
        { status: 200 },
      );
    }) as any;
    const result = await jiraConnector.listOpen(creds, 10);
    expect(result.ok).toBe(true);
    expect(result.items[0]).toMatchObject({ id: "SUP-1", subject: "Algo", url: "https://miempresa.atlassian.net/browse/SUP-1" });
  });
});
