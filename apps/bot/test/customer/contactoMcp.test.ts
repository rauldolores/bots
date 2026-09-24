/**
 * Quién es, en el CRM conectado por MCP, quien escribe o llama.
 *
 * Esto existe porque pedírselo al modelo no funcionó: tres llamadas
 * seguidas, con reglas cada vez más explícitas en el prompt, el agente
 * escribió en el CRM con `id: 1` — un número puesto por poner. El cliente SÍ
 * estaba ahí y se encontraba por el número desde el que llamaba.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  idsDeLaRespuesta,
  lineaDeContactoMcp,
  olvidarContactosMcp,
  resolverContactoEnMcp,
} from "../../src/customer/contactoMcp";
import type { Env } from "../../src/env";
import type { Db } from "../../src/db/client";

// La resolución se cachea 10 min en memoria; sin limpiarla, un test vería la
// respuesta del anterior.
beforeEach(() => olvidarContactosMcp());

const env = {} as Env;
const db = {} as Db;

/** Lo que devuelve el MCP del CRM: un `content` con el JSON de las filas dentro. */
const comoMcp = (payload: unknown) => ({ content: [{ type: "text", text: JSON.stringify(payload) }] });

describe("idsDeLaRespuesta — el formato de un MCP no está estandarizado", () => {
  it("lee el JSON que viene dentro de content[].text", () => {
    expect(idsDeLaRespuesta(comoMcp([{ id: 21, first_name: "Federico" }]))).toEqual(["21"]);
  });

  it('"Sin resultados." es vacío, no un error', () => {
    expect(idsDeLaRespuesta({ content: [{ type: "text", text: "Sin resultados." }] })).toEqual([]);
  });

  it("acepta el arreglo pelón, sin envoltorio", () => {
    expect(idsDeLaRespuesta([{ id: "abc" }, { id: "def" }])).toEqual(["abc", "def"]);
  });

  it("varias coincidencias salen todas, en orden", () => {
    expect(idsDeLaRespuesta(comoMcp([{ id: 21 }, { id: 38 }, { id: 39 }]))).toEqual(["21", "38", "39"]);
  });

  it("lo que no se entiende devuelve vacío — un id mal leído es peor que ninguno", () => {
    expect(idsDeLaRespuesta({ content: [{ type: "text", text: "esto no es json" }] })).toEqual([]);
    expect(idsDeLaRespuesta(null)).toEqual([]);
    expect(idsDeLaRespuesta(comoMcp([{ nombre: "sin id" }]))).toEqual([]);
    expect(idsDeLaRespuesta(comoMcp([{ id: "" }]))).toEqual([]);
  });
});

describe("resolverContactoEnMcp — correo primero, teléfono después, nunca el nombre", () => {
  const buscar = (respuestaPorTexto: Record<string, unknown>) => {
    const execute = vi.fn(async (args: any) => respuestaPorTexto[args.texto] ?? { content: [{ type: "text", text: "Sin resultados." }] });
    return { tools: { vinqulia_buscar_contactos: { execute } }, execute };
  };

  it("con correo y teléfono, el correo va primero y el teléfono ni se intenta", async () => {
    const { tools, execute } = buscar({ "raul@fila.com": comoMcp([{ id: 38 }]) });

    const r = await resolverContactoEnMcp(env, db, "bot1", { email: "raul@fila.com", telefono: "+525545562046" }, tools);

    expect(r).toEqual({ id: "38", coincidencias: 1 });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toEqual({ texto: "raul@fila.com" });
  });

  it("si el correo no da nada, cae al teléfono — el caso real de la llamada", async () => {
    const { tools, execute } = buscar({ "+525545562046": comoMcp([{ id: 21 }]) });

    const r = await resolverContactoEnMcp(env, db, "bot1", { email: "nadie@x.com", telefono: "+525545562046" }, tools);

    expect(r).toEqual({ id: "21", coincidencias: 1 });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0]).toEqual({ texto: "+525545562046" });
  });

  it("solo teléfono: se busca por teléfono", async () => {
    const { tools, execute } = buscar({ "+525545562046": comoMcp([{ id: 21 }]) });
    const r = await resolverContactoEnMcp(env, db, "bot1", { telefono: "+525545562046" }, tools);
    expect(r?.id).toBe("21");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("varias fichas: devuelve la primera y dice cuántas eran", async () => {
    const { tools } = buscar({ "f@x.com": comoMcp([{ id: 21 }, { id: 38 }]) });
    expect(await resolverContactoEnMcp(env, db, "bot1", { email: "f@x.com" }, tools)).toEqual({
      id: "21",
      coincidencias: 2,
    });
  });

  it("no aparece: null, no una excepción", async () => {
    const { tools } = buscar({});
    expect(await resolverContactoEnMcp(env, db, "bot1", { email: "f@x.com", telefono: "+52155" }, tools)).toBeNull();
  });

  it("sin correo ni teléfono, ni se molesta al CRM", async () => {
    const { tools, execute } = buscar({});
    expect(await resolverContactoEnMcp(env, db, "bot1", { email: "  ", telefono: null }, tools)).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it("sin herramienta de búsqueda en el MCP, null", async () => {
    expect(await resolverContactoEnMcp(env, db, "bot1", { email: "f@x.com" }, { otra_cosa: {} })).toBeNull();
  });

  it("si la búsqueda truena, null — es una mejora, no la ruta crítica", async () => {
    const tools = { crm_buscar_contactos: { execute: vi.fn(async () => { throw new Error("MCP caído"); }) } };
    expect(await resolverContactoEnMcp(env, db, "bot1", { email: "f@x.com" }, tools)).toBeNull();
  });
});

describe("lineaDeContactoMcp — lo que lee el modelo", () => {
  it("con id: se lo da hecho y le dice que no lo busque", () => {
    const l = lineaDeContactoMcp({ id: "21", coincidencias: 1 }, true)!;
    expect(l).toContain("21");
    expect(l).toMatch(/sin buscarlo antes/i);
  });

  it("con varias fichas, lo avisa en vez de callarlo", () => {
    expect(lineaDeContactoMcp({ id: "21", coincidencias: 3 }, true)).toContain("3 fichas");
  });

  // El hueco que el modelo rellenaba: si no se dice nada, se inventa un id.
  it("sin ficha: lo dice explícitamente y prohíbe inventar", () => {
    const l = lineaDeContactoMcp(null, true)!;
    expect(l).toMatch(/NO está registrada/i);
    expect(l).toMatch(/créala primero/i);
    expect(l).toMatch(/nunca uses un id inventado/i);
  });

  it("sin MCP conectado no dice nada — no hay CRM del que hablar", () => {
    expect(lineaDeContactoMcp(null, false)).toBeNull();
    expect(lineaDeContactoMcp({ id: "21", coincidencias: 1 }, false)).toBeNull();
  });
});
