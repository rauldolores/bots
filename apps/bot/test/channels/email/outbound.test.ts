import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadOutboundEmailConfig, sendOutboundEmail } from "../../../src/channels/email/outbound";
import type { Env } from "../../../src/env";

describe("loadOutboundEmailConfig", () => {
  it("null si falta cualquiera de los tres campos obligatorios (provider/apiKey/fromAddress)", () => {
    expect(loadOutboundEmailConfig({} as Env)).toBeNull();
    expect(loadOutboundEmailConfig({ EMAIL_OUTBOUND_PROVIDER: "resend" } as Env)).toBeNull();
    expect(
      loadOutboundEmailConfig({ EMAIL_OUTBOUND_PROVIDER: "resend", EMAIL_OUTBOUND_API_KEY: "re_x" } as Env),
    ).toBeNull();
  });

  it("con los tres presentes, arma la config completa", () => {
    const cfg = loadOutboundEmailConfig({
      EMAIL_OUTBOUND_PROVIDER: "mailgun",
      EMAIL_OUTBOUND_API_KEY: "key-x",
      EMAIL_OUTBOUND_DOMAIN: "minegocio.com",
      EMAIL_FROM_ADDRESS: "soporte@minegocio.com",
      EMAIL_FROM_NAME: "Soporte",
    } as Env);
    expect(cfg).toEqual({
      provider: "mailgun",
      apiKey: "key-x",
      domain: "minegocio.com",
      fromAddress: "soporte@minegocio.com",
      fromName: "Soporte",
    });
  });
});

describe("sendOutboundEmail", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("sin configurar, falla explícito (no intenta mandar nada)", async () => {
    const result = await sendOutboundEmail({} as Env, "cliente@x.com", "Re: hola", "texto");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Correo saliente");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("Mailgun: arma el POST con Basic auth y form-encoded al dominio configurado", async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response("", { status: 200 }));
    const env = {
      EMAIL_OUTBOUND_PROVIDER: "mailgun",
      EMAIL_OUTBOUND_API_KEY: "key-fake",
      EMAIL_OUTBOUND_DOMAIN: "minegocio.com",
      EMAIL_FROM_ADDRESS: "soporte@minegocio.com",
      EMAIL_FROM_NAME: "Soporte",
    } as Env;

    const result = await sendOutboundEmail(env, "cliente@x.com", "Re: hola", "texto de la respuesta");
    expect(result.ok).toBe(true);

    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("https://api.mailgun.net/v3/minegocio.com/messages");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Basic ${btoa("api:key-fake")}`);
    const body = new URLSearchParams(init.body);
    expect(body.get("from")).toBe("Soporte <soporte@minegocio.com>");
    expect(body.get("to")).toBe("cliente@x.com");
    expect(body.get("text")).toBe("texto de la respuesta");
  });

  it("Mailgun: sin dominio configurado, falla explícito", async () => {
    const env = {
      EMAIL_OUTBOUND_PROVIDER: "mailgun",
      EMAIL_OUTBOUND_API_KEY: "key-fake",
      EMAIL_FROM_ADDRESS: "soporte@minegocio.com",
    } as Env;
    const result = await sendOutboundEmail(env, "cliente@x.com", "Re: hola", "texto");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("dominio");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("Mailgun: un 4xx/5xx de Mailgun se reporta como error, no truena", async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response("Domain not found", { status: 404 }));
    const env = {
      EMAIL_OUTBOUND_PROVIDER: "mailgun",
      EMAIL_OUTBOUND_API_KEY: "key-fake",
      EMAIL_OUTBOUND_DOMAIN: "minegocio.com",
      EMAIL_FROM_ADDRESS: "soporte@minegocio.com",
    } as Env;
    const result = await sendOutboundEmail(env, "cliente@x.com", "Re: hola", "texto");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("404");
  });

  it("Resend: manda vía la API de Resend con el remitente formateado", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ id: "re_sent_1" }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const env = {
      EMAIL_OUTBOUND_PROVIDER: "resend",
      EMAIL_OUTBOUND_API_KEY: "re_fake_key",
      EMAIL_FROM_ADDRESS: "soporte@minegocio.com",
      EMAIL_FROM_NAME: "Soporte",
    } as Env;
    const result = await sendOutboundEmail(env, "cliente@x.com", "Re: hola", "texto de la respuesta");
    expect(result.ok).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalled();
  });
});
