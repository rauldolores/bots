/**
 * Tests for the Conocimiento (KB) tab routes + the budget save route.
 * Workers AI simulado; la base y pgvector son reales.
 */
import { EMBEDDING_DIMENSIONS } from "../../src/ai/embeddings";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { adminApp } from "../../src/admin/routes";
import { Db } from "../../src/db/client";
import { KbDocsRepo } from "../../src/kb/docs";
import { MediaAssetsRepo } from "../../src/db/mediaAssets";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import type { Env } from "../../src/env";

const PASSWORD = "secret123";

function basicAuthHeader(user: string, pass: string): string {
  const raw = `${user}:${pass}`;
  const b64 =
    typeof btoa === "function"
      ? btoa(raw)
      : Buffer.from(raw, "utf-8").toString("base64");
  return `Basic ${b64}`;
}

const AUTH = { Authorization: basicAuthHeader("admin", PASSWORD) };
const FORM = { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" };

let env: Env;
let repo: KbDocsRepo;
let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  env = {
    DB: db.driver,
    AI: {
      run: vi.fn(async (_m: string, input: { text: string[] }) => ({
        data: input.text.map(() => Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1)),
      })),
    },
    BOT_NAME: "TestBot",
    BUSINESS_NAME: "Negocio de Prueba",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
    DASHBOARD_PASSWORD: PASSWORD,
  } as unknown as Env;
  repo = new KbDocsRepo(db, TEST_BOT_ID);
});

/** Lo que quedó indexado de verdad, en vez de espiar un mock de Vectorize. */
function chunks() {
  return db.all<{ id: string; content: string }>(
    "SELECT id, content FROM kb_chunks ORDER BY id",
  );
}

describe("KB tab", () => {
  it("renders the list (empty state)", async () => {
    const res = await adminApp.request("/kb", { headers: AUTH }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Conocimiento del bot");
    expect(html).toContain("Escribir uno a mano");
    // La zona de subida dice qué acepta: sin esto el dueño arrastra un PDF y no entiende por qué no entra.
    expect(html).toContain("texto plano");
    expect(html).toContain(".txt, .md, .markdown, .csv");
  });

  it("save persists the doc AND indexes it", async () => {
    const res = await adminApp.request(
      "/kb/save",
      {
        method: "POST",
        headers: FORM,
        body: new URLSearchParams({ title: "Horarios", content: "Abrimos 9-7 de lunes a sábado." }),
      },
      env,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/kb?saved=1");

    const docs = await repo.list();
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe("Horarios");

    // Se indexa al guardar.
    const indexado = await chunks();
    expect(indexado).toHaveLength(1);
    expect(indexado[0].content).toContain("Abrimos 9-7");
  });

  it("editing keeps the same id (hidden field) and re-indexes", async () => {
    await adminApp.request(
      "/kb/save",
      { method: "POST", headers: FORM, body: new URLSearchParams({ title: "T", content: "v1" }) },
      env,
    );
    const [doc] = await repo.list();

    await adminApp.request(
      "/kb/save",
      { method: "POST", headers: FORM, body: new URLSearchParams({ id: doc.id, title: "T", content: "v2" }) },
      env,
    );
    const docs = await repo.list();
    expect(docs).toHaveLength(1);
    expect(docs[0].content).toBe("v2");
    // Reindexado: el chunk refleja la edición, sin dejar el viejo atrás.
    const indexado = await chunks();
    expect(indexado).toHaveLength(1);
    expect(indexado[0].content).toBe("v2");
  });

  it("rejects an empty save without touching the index", async () => {
    const res = await adminApp.request(
      "/kb/save",
      { method: "POST", headers: FORM, body: new URLSearchParams({ title: "", content: "" }) },
      env,
    );
    expect(res.status).toBe(302);
    expect(await repo.list()).toHaveLength(0);
    expect(await chunks()).toHaveLength(0);
  });

  it("delete removes the doc and its vectors", async () => {
    await adminApp.request(
      "/kb/save",
      { method: "POST", headers: FORM, body: new URLSearchParams({ title: "T", content: "C" }) },
      env,
    );
    const [doc] = await repo.list();
    expect(await chunks()).toHaveLength(1);

    const res = await adminApp.request(
      `/kb/${encodeURIComponent(doc.id)}/delete`,
      { method: "POST", headers: AUTH },
      env,
    );
    expect(res.status).toBe(302);
    expect(await repo.list()).toHaveLength(0);
    // Borrar el doc también saca sus vectores: si no, searchKb seguiría
    // devolviendo contenido que el dueño ya eliminó del panel.
    expect(await chunks()).toHaveLength(0);
  });

  it("requires auth", async () => {
    const res = await adminApp.request("/kb", {}, env);
    expect(res.status).toBe(401);
  });
});

describe("subir archivos en lote y carpetas", () => {
  const JSONH = { ...AUTH, "Content-Type": "application/json" };
  const subir = (body: Record<string, unknown>) =>
    adminApp.request("/kb/subir", { method: "POST", headers: JSONH, body: JSON.stringify(body) }, env);

  it("un archivo subido queda como documento en su carpeta, e indexado", async () => {
    const res = await subir({ carpeta: " Precios ", nombre: "lista_2026.txt", contenido: "Corte: $250\r\nTinte: $600" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, documentos: 1, reemplazados: false });

    const [doc] = await repo.list();
    expect(doc).toMatchObject({ title: "lista 2026", folder: "Precios", file_name: "lista_2026.txt", content: "Corte: $250\nTinte: $600" });
    const indexado = await chunks();
    expect(indexado).toHaveLength(1);
    expect(indexado[0].content).toContain("Tinte: $600");
  });

  // Así se actualiza la base: arrastrando otra vez el archivo que cambió.
  it("volver a subir el mismo archivo a la misma carpeta lo reemplaza, sin duplicar ni dejar vectores viejos", async () => {
    await subir({ carpeta: "Precios", nombre: "lista.txt", contenido: "Corte: $250" });
    const res = await subir({ carpeta: "Precios", nombre: "lista.txt", contenido: "Corte: $300" });
    expect(await res.json()).toMatchObject({ ok: true, reemplazados: true });

    const docs = await repo.list();
    expect(docs).toHaveLength(1);
    expect(docs[0].content).toBe("Corte: $300");
    const indexado = await chunks();
    expect(indexado).toHaveLength(1);
    expect(indexado[0].content).toBe("Corte: $300");
  });

  it("el mismo nombre en OTRA carpeta es otro documento", async () => {
    await subir({ carpeta: "Sucursal Centro", nombre: "horarios.txt", contenido: "9 a 7" });
    await subir({ carpeta: "Sucursal Norte", nombre: "horarios.txt", contenido: "10 a 8" });
    expect(await repo.list()).toHaveLength(2);
  });

  it("un archivo largo se parte en varios documentos y todos quedan indexados", async () => {
    const contenido = Array.from({ length: 80 }, (_, i) => `Producto ${i}: ${"detalle ".repeat(80)}`).join("\n\n");
    const res = await subir({ nombre: "catalogo.md", contenido });
    const j = (await res.json()) as { documentos: number };
    expect(j.documentos).toBeGreaterThan(1);
    const docs = await repo.list();
    expect(docs).toHaveLength(j.documentos);
    expect(docs.every((d) => d.file_name === "catalogo.md" && d.folder === null)).toBe(true);
    const indexado = (await chunks()).map((c) => c.content).join("\n");
    expect(indexado).toContain("Producto 0:");
    expect(indexado).toContain("Producto 79:");
  });

  it("rechaza lo que no es texto plano, y los archivos vacíos", async () => {
    let res = await subir({ nombre: "menu.pdf", contenido: "%PDF-1.4" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("texto plano");
    res = await subir({ nombre: "vacio.txt", contenido: " \n\n " });
    expect(res.status).toBe(400);
    expect(await repo.list()).toHaveLength(0);
  });

  it("si indexar falla, no deja la versión nueva a medias y conserva la anterior", async () => {
    await subir({ carpeta: "Precios", nombre: "lista.txt", contenido: "Corte: $250" });
    (env as any).AI.run = vi.fn(async () => {
      throw new Error("proveedor caído");
    });
    const res = await subir({ carpeta: "Precios", nombre: "lista.txt", contenido: "Corte: $300" });
    expect(res.status).toBe(502);
    const docs = await repo.list();
    expect(docs).toHaveLength(1);
    expect(docs[0].content).toBe("Corte: $250");
  });

  it("borrar una carpeta se lleva sus documentos y sus vectores, y deja los demás", async () => {
    await subir({ carpeta: "Promos", nombre: "a.txt", contenido: "2x1 martes" });
    await subir({ carpeta: "Promos", nombre: "b.txt", contenido: "10% estudiantes" });
    await subir({ nombre: "horarios.txt", contenido: "9 a 7" });
    const res = await adminApp.request(
      "/kb/carpeta/borrar",
      { method: "POST", headers: FORM, body: new URLSearchParams({ carpeta: "Promos" }) },
      env,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/kb?carpetaBorrada=Promos");
    const docs = await repo.list();
    expect(docs.map((d) => d.title)).toEqual(["horarios"]);
    expect(await chunks()).toHaveLength(1);
  });

  it("la lista agrupa por carpeta y ofrece eliminar sin entrar a editar", async () => {
    await subir({ carpeta: "Políticas", nombre: "devoluciones.txt", contenido: "30 días" });
    await subir({ nombre: "horarios.txt", contenido: "9 a 7" });
    const html = await (await adminApp.request("/kb", { headers: AUTH }, env)).text();
    expect(html).toContain('data-carpeta="Políticas"');
    expect(html).toContain("Sin carpeta");
    const [doc] = await repo.listByFile("Políticas", "devoluciones.txt");
    expect(html).toContain(`action="/admin/kb/${doc.id}/delete"`);
    expect(html).toContain('action="/admin/kb/carpeta/borrar"');
  });

  it("el editor mueve un documento de carpeta y lo saca si se deja vacía, sin desligarlo de su archivo", async () => {
    await subir({ carpeta: "Viejos", nombre: "faq.txt", contenido: "Pregunta" });
    const [doc] = await repo.list();
    const guardar = (folder: string) =>
      adminApp.request(
        "/kb/save",
        { method: "POST", headers: FORM, body: new URLSearchParams({ id: doc.id, title: doc.title, content: "Pregunta", folder }) },
        env,
      );
    await guardar("Nuevos");
    expect(await repo.getById(doc.id)).toMatchObject({ folder: "Nuevos", file_name: "faq.txt" });
    await guardar("");
    expect(await repo.getById(doc.id)).toMatchObject({ folder: null, file_name: "faq.txt" });
  });
});

describe("budget save route", () => {
  it("stores a valid budget and clears it when empty", async () => {
    const settings = new SettingsRepo(new Db(env.DB), TEST_BOT_ID);

    let res = await adminApp.request(
      "/costs/budget",
      { method: "POST", headers: FORM, body: new URLSearchParams({ monthly_budget: "25" }) },
      env,
    );
    expect(res.status).toBe(302);
    expect(await settings.get(SETTING_KEYS.monthlyBudget)).toBe("25");

    res = await adminApp.request(
      "/costs/budget",
      { method: "POST", headers: FORM, body: new URLSearchParams({ monthly_budget: "" }) },
      env,
    );
    expect(await settings.get(SETTING_KEYS.monthlyBudget)).toBe("");
  });

  it("ignores garbage values (clears the cap)", async () => {
    const settings = new SettingsRepo(new Db(env.DB), TEST_BOT_ID);
    await adminApp.request(
      "/costs/budget",
      { method: "POST", headers: FORM, body: new URLSearchParams({ monthly_budget: "mucho" }) },
      env,
    );
    expect(await settings.get(SETTING_KEYS.monthlyBudget)).toBe("");
  });
});

describe("biblioteca de medios — subir de verdad, no pegar una URL", () => {
  const STORAGE = "https://proyecto.supabase.co";
  let subidas: { url: string; method: string; body?: string }[];

  function mediaRepo() {
    return new MediaAssetsRepo(new Db(env.DB), TEST_BOT_ID);
  }

  /** Un Storage de mentira que se comporta como el real en lo que importa. */
  function fingirStorage(opts: { bytes?: number } = {}) {
    subidas = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any, init: any = {}) => {
        const u = String(url);
        subidas.push({ url: u, method: init.method ?? "GET", body: typeof init.body === "string" ? init.body : undefined });
        if (u.includes("/storage/v1/bucket")) return new Response("", { status: 409 }); // ya existe
        if (u.includes("/object/upload/sign/")) {
          const path = u.split("/object/upload/sign/medios/")[1];
          return new Response(JSON.stringify({ url: `/object/upload/sign/medios/${path}?token=t` }), { status: 200 });
        }
        if (u.includes("/object/public/")) {
          // HEAD: el peso REAL, que es el que manda.
          return new Response(null, {
            status: 200,
            headers: { "content-length": String(opts.bytes ?? 2 * 1024 * 1024) },
          });
        }
        return new Response("", { status: 200 });
      }),
    );
  }

  beforeEach(() => {
    (env as any).SUPABASE_URL = STORAGE;
    (env as any).SUPABASE_SERVICE_ROLE_KEY = "service-role-falsa";
    fingirStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const cuerpo = (over: Record<string, unknown> = {}) => ({
    clave: "menu",
    tipo: "documento",
    descripcion: "El menú de la semana",
    nombre: "menu.pdf",
    mime: "application/pdf",
    bytes: 2 * 1024 * 1024,
    ...over,
  });

  async function pedir(ruta: string, body: unknown) {
    return adminApp.request(
      ruta,
      { method: "POST", headers: { ...AUTH, "Content-Type": "application/json" }, body: JSON.stringify(body) },
      env,
    );
  }

  it("firma la subida cuando todo está en orden", async () => {
    const res = await pedir("/kb/archivos/firma", cuerpo());
    expect(res.status).toBe(200);
    const j = (await res.json()) as any;
    expect(j.ok).toBe(true);
    // El navegador sube DIRECTO a Storage: por eso se le devuelve una URL suya.
    expect(j.url).toContain(`${STORAGE}/storage/v1/object/upload/sign/medios/`);
    // La ruta cuelga del bot y de un UUID, no del nombre del archivo.
    expect(j.path.startsWith(`${TEST_BOT_ID}/`)).toBe(true);
    expect(j.path.endsWith("/menu.pdf")).toBe(true);
  });

  it("el bucket nace con el tope del tipo MÁS grande, aunque la primera subida sea una foto", async () => {
    // El caso que rompía: la primera subida es una imagen (5 MB) y el bucket
    // se quedaba con ese tope para siempre, así que un PDF de 8 MB fallaba.
    await pedir("/kb/archivos/firma", cuerpo({ tipo: "imagen", mime: "image/jpeg", nombre: "local.jpg" }));

    const crear = subidas.find((s) => s.method === "POST" && s.url.endsWith("/storage/v1/bucket"));
    expect(JSON.parse(crear!.body!).file_size_limit).toBe(10 * 1024 * 1024);
  });

  it("si el bucket ya existía, le reescribe los ajustes para corregirse solo", async () => {
    // fingirStorage contesta 409 (ya existe) a la creación.
    await pedir("/kb/archivos/firma", cuerpo());

    const ajuste = subidas.find((s) => s.method === "PUT" && s.url.endsWith("/storage/v1/bucket/medios"));
    expect(ajuste).toBeTruthy();
    expect(JSON.parse(ajuste!.body!)).toEqual({ public: true, file_size_limit: 10 * 1024 * 1024 });
  });

  it("no firma nada sin descripción: es lo único que el bot lee para decidir", async () => {
    const res = await pedir("/kb/archivos/firma", cuerpo({ descripcion: "  " }));
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toContain("describir");
  });

  it("no firma un tipo que ningún canal entrega", async () => {
    const res = await pedir("/kb/archivos/firma", cuerpo({ mime: "application/x-msdownload" }));
    expect(res.status).toBe(400);
  });

  it("no firma un archivo más grande de lo que el canal acepta", async () => {
    const res = await pedir("/kb/archivos/firma", cuerpo({ bytes: 11 * 1024 * 1024 }));
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toContain("10 MB");
  });

  it("registrar guarda la fila con el peso que dice STORAGE, no el que dijo el navegador", async () => {
    fingirStorage({ bytes: 3 * 1024 * 1024 });
    const path = `${TEST_BOT_ID}/abc/menu.pdf`;
    // El navegador miente y dice que pesa 1 KB.
    const res = await pedir("/kb/archivos/registrar", cuerpo({ path, bytes: 1024 }));

    expect(res.status).toBe(200);
    const guardado = await mediaRepo().getByClave("menu");
    expect(Number(guardado!.size_bytes)).toBe(3 * 1024 * 1024);
    expect(guardado!.storage_path).toBe(path);
    expect(guardado!.url).toBe(`${STORAGE}/storage/v1/object/public/medios/${path}`);
  });

  it("si el archivo subido resultó más grande del tope, se borra y no se guarda", async () => {
    fingirStorage({ bytes: 30 * 1024 * 1024 });
    const path = `${TEST_BOT_ID}/abc/enorme.pdf`;
    const res = await pedir("/kb/archivos/registrar", cuerpo({ path }));

    expect(res.status).toBe(400);
    expect(await mediaRepo().list()).toHaveLength(0);
    expect(subidas.some((s) => s.method === "DELETE" && s.url.includes(path))).toBe(true);
  });

  it("no acepta registrar un archivo de OTRO bot", async () => {
    const res = await pedir("/kb/archivos/registrar", cuerpo({ path: "otro-bot/abc/menu.pdf" }));
    expect(res.status).toBe(400);
    expect(await mediaRepo().list()).toHaveLength(0);
  });

  it("quitar un archivo lo borra también de Storage, no solo de la lista", async () => {
    await mediaRepo().upsert({
      clave: "menu",
      tipo: "documento",
      url: `${STORAGE}/storage/v1/object/public/medios/${TEST_BOT_ID}/abc/menu.pdf`,
      descripcion: "Menú",
      storagePath: `${TEST_BOT_ID}/abc/menu.pdf`,
      sizeBytes: 2048,
    });
    const [a] = await mediaRepo().list();

    const res = await adminApp.request(
      `/kb/archivos/${encodeURIComponent(a.id)}/delete`,
      { method: "POST", headers: FORM },
      env,
    );

    expect(res.status).toBe(302);
    expect(await mediaRepo().list()).toHaveLength(0);
    expect(subidas.some((s) => s.method === "DELETE")).toBe(true);
  });

  it("un enlace se guarda sin subir nada ni ocupar espacio", async () => {
    const res = await pedir("/kb/archivos/enlace", {
      clave: "Cómo llegar",
      descripcion: "La ubicación en Maps, para quien pregunte la dirección",
      url: "https://maps.google.com/?q=roma",
      titulo: "Sucursal Roma",
    });

    expect(res.status).toBe(200);
    const a = await mediaRepo().getByClave("como-llegar");
    expect(a!.tipo).toBe("enlace");
    expect(a!.titulo).toBe("Sucursal Roma");
    expect(a!.size_bytes).toBeNull();
    // Nada tocó Storage: un enlace no es un archivo nuestro.
    expect(subidas.some((s) => s.url.includes("/storage/v1/object/"))).toBe(false);
  });

  it("rechaza un enlace que no es http(s): en una tarjeta que el cliente toca, es un problema", async () => {
    const res = await pedir("/kb/archivos/enlace", {
      clave: "malo",
      descripcion: "x",
      url: "javascript:alert(1)",
    });
    expect(res.status).toBe(400);
    expect(await mediaRepo().list()).toHaveLength(0);
  });

  it("sin Storage configurado, el panel sigue ofreciendo enlaces", async () => {
    delete (env as any).SUPABASE_SERVICE_ROLE_KEY;
    const html = await (await adminApp.request("/kb", { headers: AUTH }, env)).text();
    expect(html).toContain('<option value="enlace">');
    expect(html).not.toContain('<option value="documento">');
    expect(html).toContain("Mientras tanto puedes guardar enlaces");
  });

  it("la pantalla muestra el espacio usado y el tope", async () => {
    await mediaRepo().upsert({
      clave: "menu", tipo: "documento", url: "https://x/m.pdf",
      descripcion: "El menú de la semana", sizeBytes: 5 * 1024 * 1024,
    });
    const html = await (await adminApp.request("/kb", { headers: AUTH }, env)).text();
    expect(html).toContain("Archivos que el bot puede enviar");
    expect(html).toContain("5.0 MB de 200 MB");
  });
});
