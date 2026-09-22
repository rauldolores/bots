import { describe, it, expect } from "vitest";

import worker from "../src/app";

/**
 * Cambio de dominio del panel: el host viejo (hermano del canónico) redirige
 * la navegación de personas al canónico, y deja intacto todo lo demás
 * (webhooks, widget, previews, local).
 */
describe("redirección del dominio anterior del panel", () => {
  const env = {
    BOT_NAME: "Testi",
    BUSINESS_NAME: "Test",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "15",
    DASHBOARD_BASE_URL: "https://app.nodiagents.com",
  } as any;

  const pedir = (url: string, init?: RequestInit) =>
    worker.fetch(new Request(url, { redirect: "manual", ...init }), env, {} as any);

  it("la navegación del panel en el host viejo salta al canónico, con ruta y query", async () => {
    const res = await pedir("https://panel.nodiagents.com/admin/tickets?estado=abierto");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://app.nodiagents.com/admin/tickets?estado=abierto");
  });

  it("la raíz del host viejo también salta", async () => {
    const res = await pedir("https://panel.nodiagents.com/");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://app.nodiagents.com/");
  });

  it("el host canónico no se redirige a sí mismo", async () => {
    const res = await pedir("https://app.nodiagents.com/");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin");
  });

  it("un webhook (POST) en el host viejo sigue atendiéndose ahí", async () => {
    const res = await pedir("https://panel.nodiagents.com/webhooks/whatsapp", {
      method: "POST",
      body: "{}",
    });
    expect(res.status).not.toBe(301);
  });

  it("el widget en el host viejo no se redirige", async () => {
    const res = await pedir("https://panel.nodiagents.com/widget.js");
    expect(res.status).not.toBe(301);
  });

  it("un despliegue de vista previa u otro dominio no se manda a producción", async () => {
    const preview = await pedir("https://nodia-agents-abc.vercel.app/admin");
    expect(preview.status).not.toBe(301);
    const local = await pedir("http://localhost:8787/");
    expect(local.status).toBe(302);
  });
});
