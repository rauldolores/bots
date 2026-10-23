/**
 * Logo del widget: se sube a Storage desde /admin/conexiones en vez de pegar
 * una URL externa (que se rompe sola cuando el dueño cambia de hosting).
 * Storage va simulado con fetch — lo que se prueba es el flujo y lo que queda
 * guardado en bot_channels.config, contra la base real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { adminApp } from "../../src/admin/routes";
import { Db } from "../../src/db/client";
import { BotChannelsRepo } from "../../src/db/botChannels";
import type { Env } from "../../src/env";

const PASSWORD = "secret123";
const AUTH = { Authorization: `Basic ${Buffer.from(`admin:${PASSWORD}`).toString("base64")}` };
const STORAGE = "https://proyecto.supabase.co";

let env: Env;
let db: Db;
let llamadas: { url: string; method: string }[];

/** Un Storage de mentira: firma, y el HEAD contesta el peso que se le diga. */
function fingirStorage(bytes = 50 * 1024) {
  llamadas = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init: any = {}) => {
      const u = String(url);
      llamadas.push({ url: u, method: init.method ?? "GET" });
      if (u.includes("/storage/v1/bucket")) return new Response("", { status: 409 });
      if (u.includes("/object/upload/sign/")) {
        const path = u.split("/object/upload/sign/medios/")[1];
        return new Response(JSON.stringify({ url: `/object/upload/sign/medios/${path}?token=t` }), { status: 200 });
      }
      if (u.includes("/object/public/")) {
        return new Response(null, { status: 200, headers: { "content-length": String(bytes) } });
      }
      return new Response("", { status: 200 });
    }),
  );
}

beforeEach(async () => {
  db = await createTestDb();
  env = {
    DB: db.driver,
    BOT_NAME: "TestBot",
    BUSINESS_NAME: "Negocio de Prueba",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
    DASHBOARD_PASSWORD: PASSWORD,
    SUPABASE_URL: STORAGE,
    SUPABASE_SERVICE_ROLE_KEY: "service-role-falsa",
  } as unknown as Env;
  await new BotChannelsRepo(db).upsert({ botId: TEST_BOT_ID, channel: "widget", externalId: "llave-publica", config: { title: "Hola" } });
  fingirStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function pedir(ruta: string, body?: unknown) {
  return adminApp.request(
    ruta,
    {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
}

async function widgetConfig() {
  return (await new BotChannelsRepo(db).getByBotAndChannel(TEST_BOT_ID, "widget"))!.config;
}

async function subirLogo(nombre = "logo.png") {
  const r1 = await pedir("/conexiones/widget/logo/firma", { nombre, mime: "image/png", bytes: 50 * 1024 });
  const j1 = (await r1.json()) as { ok: boolean; path: string };
  const r2 = await pedir("/conexiones/widget/logo/registrar", { path: j1.path });
  return { path: j1.path, res: r2, json: (await r2.json()) as { ok: boolean; url?: string; error?: string } };
}

describe("pantalla de conexiones", () => {
  it("con almacenamiento pide subir la imagen, no una URL", async () => {
    const html = await (await adminApp.request("/conexiones", { headers: AUTH }, env)).text();
    expect(html).toContain("data-logo-file");
    expect(html).not.toContain('name="avatar_url"');
  });

  it("sin almacenamiento (instalación propia) conserva el campo de URL", async () => {
    delete (env as any).SUPABASE_SERVICE_ROLE_KEY;
    const html = await (await adminApp.request("/conexiones", { headers: AUTH }, env)).text();
    expect(html).toContain('name="avatar_url"');
    expect(html).not.toContain("data-logo-file");
  });
});

describe("subir el logo", () => {
  it("firma, registra y deja la URL pública y la ruta en la config del widget", async () => {
    const { path, json } = await subirLogo();
    expect(json.ok).toBe(true);
    expect(path.startsWith(`${TEST_BOT_ID}/`)).toBe(true);
    expect(json.url).toBe(`${STORAGE}/storage/v1/object/public/medios/${path}`);
    expect(await widgetConfig()).toMatchObject({ title: "Hola", avatarUrl: json.url, avatarPath: path });
  });

  it("rechaza lo que no es imagen y lo que pesa más de 1 MB", async () => {
    let res = await pedir("/conexiones/widget/logo/firma", { nombre: "x.svg", mime: "image/svg+xml", bytes: 1000 });
    expect(res.status).toBe(400);
    res = await pedir("/conexiones/widget/logo/firma", { nombre: "x.png", mime: "image/png", bytes: 2 * 1024 * 1024 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("máximo");
  });

  it("si lo que llegó a Storage pesa de más (el navegador mintió), lo borra y no guarda nada", async () => {
    const r1 = await pedir("/conexiones/widget/logo/firma", { nombre: "logo.png", mime: "image/png", bytes: 1000 });
    const { path } = (await r1.json()) as { path: string };
    fingirStorage(3 * 1024 * 1024);
    const res = await pedir("/conexiones/widget/logo/registrar", { path });
    expect(res.status).toBe(400);
    expect(llamadas.some((l) => l.method === "DELETE" && l.url.endsWith(path))).toBe(true);
    expect((await widgetConfig()).avatarUrl).toBeUndefined();
  });

  it("no acepta una ruta de otro bot", async () => {
    const res = await pedir("/conexiones/widget/logo/registrar", { path: "otro-bot/abc/logo.png" });
    expect(res.status).toBe(400);
  });

  it("reemplazar el logo borra el archivo anterior", async () => {
    const primero = await subirLogo("a.png");
    const segundo = await subirLogo("b.png");
    expect(segundo.json.ok).toBe(true);
    expect((await widgetConfig()).avatarPath).toBe(segundo.path);
    expect(llamadas.some((l) => l.method === "DELETE" && l.url.endsWith(primero.path))).toBe(true);
  });

  it("guardar los demás campos del widget no borra el logo subido", async () => {
    const { path } = await subirLogo();
    const form = new URLSearchParams({ title: "Nuevo título", position: "bottom-left" });
    await adminApp.request(
      "/conexiones/widget/config",
      { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() },
      env,
    );
    const cfg = await widgetConfig();
    expect(cfg.title).toBe("Nuevo título");
    expect(cfg.avatarPath).toBe(path);
    expect(cfg.avatarUrl).toContain(path);
  });

  it("quitar el logo lo borra de Storage y de la config", async () => {
    const { path } = await subirLogo();
    const res = await pedir("/conexiones/widget/logo/quitar");
    expect(res.status).toBe(200);
    const cfg = await widgetConfig();
    expect(cfg.avatarUrl).toBeUndefined();
    expect(cfg.avatarPath).toBeUndefined();
    expect(cfg.title).toBe("Hola");
    expect(llamadas.some((l) => l.method === "DELETE" && l.url.endsWith(path))).toBe(true);
  });
});
