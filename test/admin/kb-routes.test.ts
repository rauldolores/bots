/**
 * Tests for the Conocimiento (KB) tab routes + the budget save route.
 * Workers AI simulado; la base y pgvector son reales.
 */
import { EMBEDDING_DIMENSIONS } from "../../src/ai/embeddings";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { adminApp } from "../../src/admin/routes";
import { Db } from "../../src/db/client";
import { KbDocsRepo } from "../../src/kb/docs";
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
    expect(html).toContain("Nuevo documento");
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
