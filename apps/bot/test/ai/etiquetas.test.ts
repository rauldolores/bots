// Etiquetas del dueño (db/etiquetas.ts) que asigna el revisor rápido
// (ai/etiquetar.ts): el repositorio, el etiquetado, el filtro de campañas, la
// bandeja y las rutas. La red de TypeSafe se simula; la base es real.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, TEST_BOT_ID, createSecondTestBot } from "../helpers/pgSetup";
import { EtiquetasRepo, EtiquetaDuplicadaError, DemasiadasEtiquetasError, MAX_ETIQUETAS } from "../../src/db/etiquetas";
import { etiquetarConversacion } from "../../src/ai/etiquetar";
import { segmentMembers } from "../../src/segments";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { adminApp } from "../../src/admin/routes";
import { renderInboxList } from "../../src/admin/views/conversations";
import { MODELO_JEV } from "../../src/ai/jev";
import type { Db } from "../../src/db/client";

const PASSWORD = "secret123";
const AUTH = { Authorization: `Basic ${Buffer.from(`admin:${PASSWORD}`).toString("base64")}` };

let db: Db;
let env: any;
let repo: EtiquetasRepo;
/** La probabilidad que "contesta" Jev para cada etiqueta, por nombre. */
let respuestas: Record<string, number> = {};
let typesafeCaido = false;
let idsPorNombre: Record<string, string> = {};

function redSimulada(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  if (!String(url).includes("typesafe")) return Promise.reject(new Error("red no simulada"));
  if (typesafeCaido) return Promise.resolve(new Response("{}", { status: 503 }));
  const cuerpo = JSON.parse(String(init?.body));
  const nombreDe = Object.fromEntries(Object.entries(idsPorNombre).map(([n, id]) => [id, n]));
  const answers = Object.fromEntries(
    Object.keys(cuerpo.questions).map((id) => [id, { type: "noul", noul: respuestas[nombreDe[id]] ?? 0.01 }]),
  );
  return Promise.resolve(
    new Response(JSON.stringify({ model: MODELO_JEV, answers, usage: { input_tokens: 400, output_tokens: 10 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

async function conversacionCon(texto: string, usuario: string) {
  const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("telegram", usuario);
  await new MessagesRepo(db, TEST_BOT_ID).append(conv.id, "user", texto);
  await new MessagesRepo(db, TEST_BOT_ID).append(conv.id, "assistant", "Con gusto te ayudo.");
  return conv.id;
}
async function crear(nombre: string, descripcion: string) {
  const id = await repo.create(nombre, descripcion);
  idsPorNombre[nombre] = id;
  return id;
}

beforeEach(async () => {
  db = await createTestDb();
  repo = new EtiquetasRepo(db, TEST_BOT_ID);
  respuestas = {};
  idsPorNombre = {};
  typesafeCaido = false;
  vi.stubGlobal("fetch", vi.fn(redSimulada));
  env = {
    DB: db.driver,
    ANTHROPIC_API_KEY: "sk-test",
    TYPESAFE_API_KEY: "ts-prueba",
    DASHBOARD_PASSWORD: PASSWORD,
    BOT_NAME: "T",
    BUSINESS_NAME: "T",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
  };
});
afterEach(() => vi.unstubAllGlobals());

describe("EtiquetasRepo", () => {
  it("no deja dos etiquetas con el mismo nombre, sin importar mayúsculas", async () => {
    await repo.create("Precios", "Pregunta cuánto cuesta algo");
    await expect(repo.create("precios", "otra")).rejects.toBeInstanceOf(EtiquetaDuplicadaError);
  });

  it(`tiene un tope de ${MAX_ETIQUETAS}`, async () => {
    for (let i = 0; i < MAX_ETIQUETAS; i++) await repo.create(`e${i}`, "x");
    await expect(repo.create("una más", "x")).rejects.toBeInstanceOf(DemasiadasEtiquetasError);
  });

  it("borrar con un id que no es UUID no revienta", async () => {
    await expect(repo.delete("basura")).resolves.toBeUndefined();
  });

  it("no guarda probabilidades de etiquetas de OTRO bot", async () => {
    const otroBot = await createSecondTestBot(db);
    const ajena = await new EtiquetasRepo(db, otroBot).create("Ajena", "x");
    const convId = await conversacionCon("hola", "u-aislado");
    await repo.guardar(convId, new Map([[ajena, 0.99]]));
    expect(await db.all("SELECT * FROM etiquetas_de_conversacion")).toHaveLength(0);
  });
});

describe("etiquetarConversacion", () => {
  it("con el revisor apagado no hace nada", async () => {
    await crear("Precios", "Pregunta cuánto cuesta algo");
    const convId = await conversacionCon("¿Cuánto cuesta?", "u1");
    expect(await etiquetarConversacion(env, db, TEST_BOT_ID, convId)).toBe(0);
  });

  it("guarda la probabilidad de cada etiqueta, y la bandeja muestra solo las que pasan el umbral", async () => {
    await new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.jevModo, "sombra");
    await crear("Precios", "El cliente pregunta cuánto cuesta algún producto o plan");
    await crear("Quiere cita", "El cliente quiere agendar una cita");
    respuestas = { Precios: 0.93, "Quiere cita": 0.2 };
    const convId = await conversacionCon("¿Cuánto cuesta el plan básico?", "u2");

    expect(await etiquetarConversacion(env, db, TEST_BOT_ID, convId)).toBe(2);
    const html = await renderInboxList(env, TEST_BOT_ID, {} as any);
    expect(html).toContain("· Precios");
    expect(html).not.toContain("Quiere cita");
  });

  it("si Jev se cae no guarda nada ni lanza", async () => {
    await new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.jevModo, "sombra");
    await crear("Precios", "x");
    typesafeCaido = true;
    const convId = await conversacionCon("hola", "u3");
    expect(await etiquetarConversacion(env, db, TEST_BOT_ID, convId)).toBe(0);
    expect(await db.all("SELECT * FROM etiquetas_de_conversacion")).toHaveLength(0);
  });
});

describe("campañas por etiqueta", () => {
  it("el filtro trae solo las conversaciones que tienen la etiqueta", async () => {
    const precios = await crear("Precios", "x");
    const a = await conversacionCon("¿cuánto cuesta?", "ua");
    const b = await conversacionCon("hola", "ub");
    await repo.guardar(a, new Map([[precios, 0.9]]));
    await repo.guardar(b, new Map([[precios, 0.3]]));
    const miembros = await segmentMembers(db, TEST_BOT_ID, { etiquetas: [precios] });
    expect(miembros.map((m) => m.conversationId)).toEqual([a]);
  });
});

describe("rutas de etiquetas en /admin/campanas", () => {
  const post = (path: string, fields: Record<string, string> = {}) =>
    adminApp.request(
      path,
      { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() },
      env,
    );

  it("sin la llave de Jev, la sección no aparece", async () => {
    delete env.TYPESAFE_API_KEY;
    const html = await (await adminApp.request("/campanas", { headers: AUTH }, env)).text();
    expect(html).not.toContain('data-testid="etiquetas"');
  });

  it("crea, muestra (con aviso si el revisor está apagado) y borra", async () => {
    expect((await post("/campanas/etiquetas", { nombre: "  Precios  ", descripcion: "Pregunta cuánto cuesta" })).status).toBe(302);
    const html = await (await adminApp.request("/campanas", { headers: AUTH }, env)).text();
    expect(html).toContain('data-testid="etiquetas"');
    expect(html).toContain("Precios");
    expect(html).toContain("prende el <b>Revisor rápido</b>");
    const [e] = await repo.list();
    expect(e.nombre).toBe("Precios");
    await post(`/campanas/etiquetas/${e.id}/borrar`);
    expect(await repo.list()).toHaveLength(0);
  });

  it("una etiqueta repetida vuelve con el error en la pantalla, no con un 500", async () => {
    await post("/campanas/etiquetas", { nombre: "Precios", descripcion: "x" });
    const r = await post("/campanas/etiquetas", { nombre: "PRECIOS", descripcion: "y" });
    expect(r.status).toBe(302);
    expect(decodeURIComponent(r.headers.get("location") ?? "")).toContain("Ya existe la etiqueta");
  });
});
