/**
 * El panel de Habilidades (F8): crear/editar la tarea, y la gestión de llaves.
 *
 * Lo que más importa aquí es que el dueño NUNCA vea un JSON Schema: define
 * campos en un formulario y de ahí sale el contrato. Y que la llave se muestre
 * una sola vez.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { adminApp } from "../../src/admin/routes";
import { Db } from "../../src/db/client";
import { BotSkillsRepo } from "../../src/db/skills";
import { BotApiKeysRepo } from "../../src/db/apiKeys";
import { parseOutputFields, validateFields } from "../../src/admin/views/habilidades";
import type { Env } from "../../src/env";

const PASSWORD = "secret123";
const AUTH = { Authorization: `Basic ${Buffer.from(`admin:${PASSWORD}`).toString("base64")}` };

let db: Db;
let env: Env;

beforeEach(async () => {
  db = await createTestDb();
  env = {
    DB: db.driver,
    DASHBOARD_PASSWORD: PASSWORD,
    BOT_NAME: "Testi",
    BUSINESS_NAME: "Negocio de Prueba",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "15",
    DASHBOARD_BASE_URL: "http://localhost:8787",
    ANTHROPIC_API_KEY: "sk-test",
  } as unknown as Env;
});

function form(pairs: [string, string][]): string {
  const p = new URLSearchParams();
  for (const [k, v] of pairs) p.append(k, v);
  return p.toString();
}

function post(path: string, body: string) {
  return adminApp.request(
    path,
    {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
    env,
  );
}

describe("parseOutputFields", () => {
  it("arma los campos desde los arreglos paralelos del formulario", () => {
    const fd = new FormData();
    fd.append("field_key", "interes");
    fd.append("field_type", "string");
    fd.append("field_desc", "alto/medio/bajo");
    fd.append("field_required", "1");
    fd.append("field_key", "monto");
    fd.append("field_type", "number");
    fd.append("field_desc", "");
    fd.append("field_required", "0");

    expect(parseOutputFields(fd)).toEqual([
      { key: "interes", type: "string", description: "alto/medio/bajo", required: true },
      { key: "monto", type: "number", description: undefined, required: false },
    ]);
  });

  it("ignora las filas vacías que deja el botón de agregar", () => {
    const fd = new FormData();
    fd.append("field_key", "");
    fd.append("field_type", "string");
    fd.append("field_desc", "");
    fd.append("field_required", "0");
    expect(parseOutputFields(fd)).toEqual([]);
  });
});

describe("validateFields", () => {
  it("exige al menos un campo", () => {
    expect(validateFields([])).toMatch(/al menos un campo/i);
  });

  it("rechaza nombres inválidos y repetidos con un mensaje entendible", () => {
    expect(validateFields([{ key: "Mi Campo", type: "string" }])).toMatch(/minúsculas/i);
    expect(
      validateFields([
        { key: "a", type: "string" },
        { key: "a", type: "string" },
      ]),
    ).toMatch(/repetido/i);
  });

  it("acepta un conjunto válido", () => {
    expect(validateFields([{ key: "resultado_final", type: "string", required: true }])).toBeNull();
  });
});

describe("crear habilidad", () => {
  it("la guarda con un slug derivado del nombre", async () => {
    const res = await post(
      "/habilidades/nueva",
      form([
        ["name", "Calificación de Leads"],
        ["instructions", "Califica al prospecto."],
        ["field_key", "interes"],
        ["field_type", "string"],
        ["field_desc", "qué tanto"],
        ["field_required", "1"],
      ]),
    );
    expect(res.status).toBe(302);

    const skills = await new BotSkillsRepo(db, TEST_BOT_ID).list();
    expect(skills).toHaveLength(1);
    expect(skills[0].slug).toBe("calificacion-de-leads");
    expect(skills[0].output_fields).toEqual([
      { key: "interes", type: "string", description: "qué tanto", required: true },
    ]);
  });

  it("dos habilidades con el mismo nombre no chocan de slug", async () => {
    const campos: [string, string][] = [
      ["field_key", "x"],
      ["field_type", "string"],
      ["field_desc", ""],
      ["field_required", "1"],
    ];
    const body = form([["name", "Calificar"], ["instructions", "..."], ...campos]);
    await post("/habilidades/nueva", body);
    await post("/habilidades/nueva", body);

    const slugs = (await new BotSkillsRepo(db, TEST_BOT_ID).list()).map((s) => s.slug).sort();
    expect(slugs).toEqual(["calificar", "calificar-2"]);
  });

  it("sin campos válidos vuelve a mostrar el formulario con el error, sin guardar", async () => {
    const res = await post(
      "/habilidades/nueva",
      form([
        ["name", "Sin campos"],
        ["instructions", "..."],
      ]),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("al menos un campo");
    expect(await new BotSkillsRepo(db, TEST_BOT_ID).list()).toHaveLength(0);
  });
});

describe("editar y borrar", () => {
  async function crear() {
    await post(
      "/habilidades/nueva",
      form([
        ["name", "Calificar"],
        ["instructions", "original"],
        ["field_key", "a"],
        ["field_type", "string"],
        ["field_desc", ""],
        ["field_required", "1"],
      ]),
    );
    return (await new BotSkillsRepo(db, TEST_BOT_ID).list())[0];
  }

  it("guarda los cambios y permite apagarla", async () => {
    const skill = await crear();
    const res = await post(
      `/habilidades/${skill.id}`,
      form([
        ["name", "Calificar mejor"],
        ["instructions", "nueva instrucción"],
        ["field_key", "a"],
        ["field_type", "number"],
        ["field_desc", ""],
        ["field_required", "1"],
        ["enabled", "0"],
      ]),
    );
    expect(res.status).toBe(302);

    const fresh = await new BotSkillsRepo(db, TEST_BOT_ID).getById(skill.id);
    expect(fresh?.name).toBe("Calificar mejor");
    expect(fresh?.instructions).toBe("nueva instrucción");
    expect(fresh?.output_fields[0].type).toBe("number");
    expect(fresh?.enabled).toBe(false);
    // Apagada, la API ya no la ve.
    expect(await new BotSkillsRepo(db, TEST_BOT_ID).getEnabledBySlug(skill.slug)).toBeNull();
  });

  it("borrar la quita", async () => {
    const skill = await crear();
    expect((await post(`/habilidades/${skill.id}/borrar`, "")).status).toBe(302);
    expect(await new BotSkillsRepo(db, TEST_BOT_ID).list()).toHaveLength(0);
  });
});

describe("llaves de acceso", () => {
  it("la llave se muestra UNA vez y después solo queda el prefijo", async () => {
    const res = await post("/habilidades/llaves", form([["name", "ERP"]]));
    expect(res.status).toBe(302);

    const destino = res.headers.get("location") ?? "";
    const plaintext = new URL(`http://x${destino}`).searchParams.get("key") ?? "";
    expect(plaintext).toMatch(/^na_[0-9a-f]{8}_[0-9a-f]{48}$/);

    // Guardada, nunca en claro.
    const keys = await new BotApiKeysRepo(db).listByBot(TEST_BOT_ID);
    expect(keys).toHaveLength(1);
    expect(keys[0].name).toBe("ERP");
    expect(JSON.stringify(keys[0])).not.toContain(plaintext);

    // La pantalla muestra solo el prefijo enmascarado.
    const page = await adminApp.request("/habilidades", { headers: AUTH }, env);
    const html = await page.text();
    expect(html).toContain(`na_${keys[0].key_prefix}_••••`);
    expect(html).not.toContain(plaintext);
  });

  it("revocar deja la fila pero apagada", async () => {
    await post("/habilidades/llaves", form([["name", "ERP"]]));
    const [key] = await new BotApiKeysRepo(db).listByBot(TEST_BOT_ID);

    expect((await post(`/habilidades/llaves/${key.id}/revocar`, "")).status).toBe(302);
    const [fresh] = await new BotApiKeysRepo(db).listByBot(TEST_BOT_ID);
    expect(fresh.enabled).toBe(false);
  });
});
