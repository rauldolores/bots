/**
 * Los argumentos que manda el agente se validan ANTES de ejecutar la tool.
 *
 * El caso real (2026-09-09, 14:02): el agente llamó handoffHuman sin
 * `category`. Ese campo está declarado `z.enum([...]).default("other")`, pero
 * el puente de voz llamaba `execute()` en crudo —sin pasar por el esquema— así
 * que el default nunca se aplicaba. El `undefined` viajó hasta el INSERT y el
 * driver de Postgres lo rechazó con "UNDEFINED_VALUE: Undefined values are not
 * allowed". El cliente escuchó "tuve un problema técnico" y su ticket urgente
 * no se abrió.
 *
 * En el camino de texto no pasaba: ahí el AI SDK valida por su cuenta. Era un
 * fallo exclusivo de las llamadas, y le podía tocar a CUALQUIER tool con un
 * campo con default.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { jsonSchema } from "ai";
import { validarParametros } from "../../src/channels/voice/validarParametros";

const toolConDefaults = {
  inputSchema: z.object({
    reason: z.string(),
    summary: z.string(),
    category: z.enum(["billing", "product", "complaint", "other"]).default("other"),
    priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
    contact: z.string().optional(),
  }),
};

describe("validarParametros", () => {
  it("aplica los defaults que el modelo omitió — el caso exacto que tronó", () => {
    return validarParametros(toolConDefaults, {
      reason: "problema técnico con CRM, no puede ingresar",
      summary: "Cliente reporta mucha urgencia",
      priority: "urgent",
      contact: "+525545562046",
    }).then((r) => {
      expect(r.ok).toBe(true);
      if (r.ok) {
        const v = r.valor as Record<string, unknown>;
        // Sin esto llegaba `undefined` al INSERT.
        expect(v.category).toBe("other");
        expect(v.priority).toBe("urgent"); // lo que sí mandó se respeta
      }
    });
  });

  it("ningún campo queda en undefined después de validar", async () => {
    const r = await validarParametros(toolConDefaults, { reason: "x", summary: "y" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const conUndefined = Object.entries(r.valor as Record<string, unknown>)
        .filter(([, v]) => v === undefined)
        .map(([k]) => k);
      expect(conUndefined).toEqual([]);
    }
  });

  it("un argumento inválido se rechaza con un motivo legible, no con un error opaco", async () => {
    // Ahora que las tools esperan respuesta, el agente LEE este motivo y puede
    // corregirse dentro de la misma llamada.
    const r = await validarParametros(toolConDefaults, { reason: "x", summary: "y", priority: "urgentísimo" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo.length).toBeGreaterThan(0);
  });

  it("falta un campo obligatorio: se rechaza antes de tocar la base", async () => {
    const r = await validarParametros(toolConDefaults, { summary: "sin reason" });
    expect(r.ok).toBe(false);
  });

  it("una tool sin esquema pasa tal cual — es lo que ya hacía", async () => {
    const r = await validarParametros({}, { lo: "que sea" });
    expect(r).toEqual({ ok: true, valor: { lo: "que sea" } });
  });

  it("las tools de MCP (JSON Schema pelón) no se bloquean", async () => {
    // Llegan sin validador propio. Antes pasaban directo y deben seguir
    // pasando: romperlas por ser estrictos aquí sería peor que el bug.
    const mcp = { inputSchema: jsonSchema({ type: "object", properties: { sql: { type: "string" } } } as any) };
    const r = await validarParametros(mcp, { sql: "SELECT 1" });
    expect(r.ok).toBe(true);
  });

  it("sin argumentos, devuelve un objeto vacío en vez de undefined", async () => {
    const r = await validarParametros({}, undefined);
    expect(r).toEqual({ ok: true, valor: {} });
  });
});
