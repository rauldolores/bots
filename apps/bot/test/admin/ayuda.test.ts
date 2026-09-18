/**
 * /admin/ayuda — guía, preguntas frecuentes, glosario y soporte.
 *
 * El contenido es datos (help/contenido.ts); aquí se cubre que esté
 * íntegro (ids únicos, enlaces internos que existen, rutas del panel
 * válidas), que la pantalla se pinte con todo, y que el formulario de
 * soporte valide y redacte el correo con el contexto del usuario.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "../helpers/pgSetup";
import { adminApp } from "../../src/admin/routes";
import { FAQ, GLOSARIO, GUIA } from "../../src/admin/help/contenido";
import { redactarSoporte } from "../../src/admin/help/soporte";
import type { Env } from "../../src/env";

const enviarSoporteMock = vi.fn(async () => ({ ok: true }) as { ok: true } | { ok: false; error: string });
vi.mock("../../src/admin/help/soporte", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/admin/help/soporte")>();
  return { ...real, enviarSoporte: (...args: unknown[]) => (enviarSoporteMock as any)(...args) };
});

const PASSWORD = "secret123";
const AUTH = { Authorization: `Basic ${Buffer.from(`admin:${PASSWORD}`).toString("base64")}` };

let env: Env;

beforeEach(async () => {
  const db = (await createTestDb()) as any;
  env = {
    DB: db.driver,
    ANTHROPIC_API_KEY: "sk-test",
    BOT_NAME: "TestBot",
    BUSINESS_NAME: "Negocio de Prueba",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
    DASHBOARD_PASSWORD: PASSWORD,
    DASHBOARD_BASE_URL: "https://panel.test",
  } as unknown as Env;
  enviarSoporteMock.mockReset().mockResolvedValue({ ok: true });
});

describe("el contenido está íntegro", () => {
  const articulos = GUIA.flatMap((s) => s.articulos);
  const ids = new Set([...articulos.map((a) => a.id), ...FAQ.map((p) => p.id), ...GUIA.map((s) => `guia-${s.id}`)]);

  it("hay guía, preguntas y glosario de verdad (no una pantalla vacía)", () => {
    expect(GUIA.length).toBeGreaterThanOrEqual(5);
    expect(articulos.length).toBeGreaterThanOrEqual(20);
    expect(FAQ.length).toBeGreaterThanOrEqual(25);
    expect(GLOSARIO.length).toBeGreaterThanOrEqual(20);
  });

  it("los ids de artículos y preguntas son únicos", () => {
    const todos = [...articulos.map((a) => a.id), ...FAQ.map((p) => p.id)];
    expect(new Set(todos).size).toBe(todos.length);
  });

  it("cada pregunta que apunta a un artículo apunta a uno que existe", () => {
    for (const p of FAQ) if (p.articulo) expect(ids.has(p.articulo), `${p.id} → ${p.articulo}`).toBe(true);
  });

  it("los enlaces internos del texto (/admin/ayuda#id) apuntan a ids que existen", () => {
    const textos = [
      ...articulos.flatMap((a) => a.cuerpo),
      ...FAQ.flatMap((p) => p.respuesta),
    ].map((b) => ("texto" in b ? b.texto : b.items.join(" ")));
    for (const t of [...textos, ...GLOSARIO.map((g) => g.definicion)]) {
      for (const m of t.matchAll(/\]\(\/admin\/ayuda#([a-z0-9-]+)\)/g)) {
        expect(ids.has(m[1]), `enlace a #${m[1]}`).toBe(true);
      }
    }
  });

  it("las rutas de los artículos son del panel", () => {
    for (const a of articulos) if (a.ruta) expect(a.ruta.startsWith("/admin/")).toBe(true);
  });

  it("cada pantalla del menú tiene su artículo", () => {
    const rutas = new Set(articulos.map((a) => (a.ruta ?? "").split("?")[0]));
    for (const r of ["/admin/overview", "/admin/conversations", "/admin/leads", "/admin/tickets", "/admin/calendario", "/admin/campanas", "/admin/seguimientos", "/admin/agente", "/admin/kb", "/admin/habilidades", "/admin/entrenamiento", "/admin/mejoras", "/admin/conexiones", "/admin/telefono", "/admin/config", "/admin/organizaciones", "/admin/usuarios", "/admin/insights", "/admin/stats", "/admin/costs", "/admin/plan"]) {
      expect(rutas.has(r), r).toBe(true);
    }
  });
});

describe("GET /admin/ayuda", () => {
  it("pinta la guía, las preguntas, el glosario y el formulario de soporte", async () => {
    const res = await adminApp.request("/ayuda", { headers: AUTH }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Guía de uso");
    expect(html).toContain("Preguntas frecuentes");
    expect(html).toContain("Glosario");
    expect(html).toContain('action="/admin/ayuda/soporte"');
    expect(html).toContain("asesor@kontrolia.io");
    for (const s of GUIA) expect(html).toContain(`id="guia-${s.id}"`);
    for (const a of GUIA.flatMap((s) => s.articulos)) expect(html).toContain(`id="${a.id}"`);
    expect(html).toContain('id="ayuda-buscar"');
  });

  it("aparece en el menú y en la cabecera", async () => {
    const html = await (await adminApp.request("/ayuda", { headers: AUTH }, env)).text();
    expect(html).toContain('href="/admin/ayuda"');
    expect(html).toContain("Ayuda y soporte");
  });

  it("las marcas del contenido salen como HTML seguro: negritas y enlaces, nunca etiquetas crudas", async () => {
    const html = await (await adminApp.request("/ayuda", { headers: AUTH }, env)).text();
    expect(html).toContain("<b>Llenar mis datos</b>");
    expect(html).not.toMatch(/\*\*[^*]+\*\*/);
    expect(html).toContain('href="/admin/overview"');
  });

  it("SUPPORT_EMAIL cambia el destino que se muestra", async () => {
    const html = await (await adminApp.request("/ayuda", { headers: AUTH }, { ...env, SUPPORT_EMAIL: "ayuda@mi-empresa.com" } as Env)).text();
    expect(html).toContain("ayuda@mi-empresa.com");
    expect(html).not.toContain("asesor@kontrolia.io");
  });
});

describe("POST /admin/ayuda/soporte", () => {
  const post = (fields: Record<string, string>) =>
    adminApp.request(
      "/ayuda/soporte",
      { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() },
      env,
    );

  it("rechaza un formulario incompleto sin mandar nada", async () => {
    const res = await post({ tema: "Otra cosa", mensaje: "corto", correo: "no-es-correo" });
    expect(res.status).toBe(302);
    expect(decodeURIComponent(res.headers.get("location") ?? "")).toContain("Falta el tema");
    expect(enviarSoporteMock).not.toHaveBeenCalled();
  });

  it("manda el mensaje con el contexto del bot y confirma en pantalla", async () => {
    const res = await post({ tema: "El bot responde mal o no responde", mensaje: "Desde ayer no contesta en Telegram.", correo: "duena@negocio.com", telefono: "+52 55 1234 5678" });
    expect(res.status).toBe(302);
    expect(decodeURIComponent(res.headers.get("location") ?? "")).toContain("Recibimos tu mensaje");
    expect(enviarSoporteMock).toHaveBeenCalledTimes(1);
    const [, solicitud] = enviarSoporteMock.mock.calls[0] as unknown as [Env, Parameters<typeof redactarSoporte>[0]];
    expect(solicitud.tema).toBe("El bot responde mal o no responde");
    expect(solicitud.correo).toBe("duena@negocio.com");
    expect(solicitud.contexto.botName).toBe("Test Bot"); // el bot de prueba de pgSetup
    expect(solicitud.contexto.baseUrl).toBe("https://panel.test");
  });

  it("si el envío falla, lo dice y ofrece el correo directo", async () => {
    enviarSoporteMock.mockResolvedValue({ ok: false, error: "No pudimos enviar tu mensaje desde aquí. Escríbenos directo a asesor@kontrolia.io y te atendemos igual." });
    const res = await post({ tema: "Otra cosa", mensaje: "Un mensaje suficientemente largo.", correo: "duena@negocio.com" });
    expect(decodeURIComponent(res.headers.get("location") ?? "")).toContain("Escríbenos directo");
  });
});

describe("redactarSoporte", () => {
  it("pone primero lo que escribió la persona y después el contexto que adjunta el panel", () => {
    const { subject, text } = redactarSoporte({
      tema: "Plan, pagos y facturación",
      mensaje: "No me deja cambiar a anual.",
      correo: "duena@negocio.com",
      telefono: "",
      contexto: { email: "duena@negocio.com", organizationId: "org-1", botId: "bot-1", botName: "Clínica Sol", plan: "Plan Pro (active)", baseUrl: "https://panel.test" },
    });
    expect(subject).toContain("Plan, pagos y facturación");
    expect(subject).toContain("Clínica Sol");
    expect(text.indexOf("No me deja cambiar a anual.")).toBeLessThan(text.indexOf("Contexto"));
    expect(text).toContain("Organización: org-1");
    expect(text).toContain("Plan: Plan Pro (active)");
    expect(text).not.toContain("Teléfono / WhatsApp");
  });
});
