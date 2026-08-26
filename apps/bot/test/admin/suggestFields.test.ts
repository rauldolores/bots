/**
 * POST /admin/config/suggest-fields — el botón "Sugerir campos" de
 * "Información del negocio": una llamada corta al LLM ya configurado del bot
 * para sugerir qué datos capturar según el giro. Nunca debe bloquear al
 * dueño: sin niche, sin LLM, o si la llamada falla, siempre responde algo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDb } from "../helpers/pgSetup";
import { adminApp } from "../../src/admin/routes";
import type { Env } from "../../src/env";

const generateObjectMock = vi.fn();

vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => generateObjectMock(...args),
}));

vi.mock("../../src/llm/provider", () => ({
  createModel: () => ({
    provider: "anthropic",
    modelId: "claude-haiku-test",
    model: { modelId: "claude-haiku-test" },
    supportsPromptCache: true,
  }),
}));

const PASSWORD = "secret123";
function basicAuthHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}
const AUTH = { Authorization: basicAuthHeader("admin", PASSWORD) };

let env: Env;

beforeEach(async () => {
  const d1 = (await createTestDb()) as any;
  env = {
    DB: d1.driver,
    ANTHROPIC_API_KEY: "sk-test",
    BOT_NAME: "TestBot",
    BUSINESS_NAME: "Negocio de Prueba",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
    DASHBOARD_PASSWORD: PASSWORD,
  } as unknown as Env;
  generateObjectMock.mockReset();
});

interface SuggestFieldsBody {
  fields: { key: string; placeholder?: string }[];
}

async function postSuggest(niche: string) {
  const fd = new URLSearchParams({ niche });
  return adminApp.request(
    "/config/suggest-fields",
    { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: fd.toString() },
    env,
  );
}

async function suggestFieldsBody(res: Response): Promise<SuggestFieldsBody> {
  return (await res.json()) as SuggestFieldsBody;
}

describe("POST /admin/config/suggest-fields", () => {
  it("sin niche, devuelve el fallback sin llamar al LLM", async () => {
    const res = await postSuggest("");
    expect(res.status).toBe(200);
    const body = await suggestFieldsBody(res);
    expect(body.fields.length).toBeGreaterThanOrEqual(3);
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it("camino feliz: valida y devuelve lo que responde el LLM", async () => {
    generateObjectMock.mockResolvedValue({
      object: { fields: [{ key: "Tipo de corte", placeholder: "Ej. degradado, clásico" }, { key: "Garantía", placeholder: "" }, { key: "Estilo de barbería", placeholder: "" }] },
    });
    const res = await postSuggest("barbería");
    expect(res.status).toBe(200);
    const body = await suggestFieldsBody(res);
    expect(body.fields).toHaveLength(3);
    expect(body.fields[0].key).toBe("Tipo de corte");
    expect(generateObjectMock).toHaveBeenCalledTimes(1);
    const call = generateObjectMock.mock.calls[0][0] as { prompt: string };
    expect(call.prompt).toContain("barbería");
  });

  it("si el LLM falla (o generateObject rechaza por no cumplir el schema, como hace el SDK real), cae al fallback y nunca responde 500", async () => {
    generateObjectMock.mockRejectedValue(new Error("modelo no disponible"));
    const res = await postSuggest("taquería");
    expect(res.status).toBe(200);
    const body = await suggestFieldsBody(res);
    expect(body.fields.length).toBeGreaterThanOrEqual(3);
  });
});
