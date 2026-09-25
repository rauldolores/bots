// La huella del agente de ElevenLabs tiene que cambiar cuando cambia la FORMA
// de una herramienta, no solo su nombre. Pasó el 2026-09-24: handoffHuman ganó
// un campo, la huella no se movió, y el agente de voz siguió con la
// declaración vieja — cada ticket por teléfono se rechazaba.
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { tool } from "ai";
import { formaDeHerramientas } from "../../src/channels/voice/elevenlabsTools";
import { huellaDeConfiguracion } from "../../src/channels/voice/elevenlabsSetup";

const conCampos = (campos: Record<string, z.ZodTypeAny>, descripcion = "Abre un ticket") =>
  tool({ description: descripcion, inputSchema: z.object(campos), execute: async () => ({}) });

describe("formaDeHerramientas", () => {
  it("cambia si una herramienta gana un campo", async () => {
    const antes = await formaDeHerramientas({ handoffHuman: conCampos({ reason: z.string() }) });
    const despues = await formaDeHerramientas({
      handoffHuman: conCampos({ reason: z.string(), naturaleza: z.enum(["problema", "interes_comercial"]) }),
    });
    expect(despues).not.toBe(antes);
  });

  it("cambia si cambia la descripción", async () => {
    const a = await formaDeHerramientas({ t: conCampos({ q: z.string() }, "uno") });
    const b = await formaDeHerramientas({ t: conCampos({ q: z.string() }, "dos") });
    expect(a).not.toBe(b);
  });

  it("no cambia por el orden en que llegan las herramientas", async () => {
    const x = conCampos({ a: z.string() });
    const y = conCampos({ b: z.string() });
    expect(await formaDeHerramientas({ x, y })).toBe(await formaDeHerramientas({ y, x }));
  });

  it("la huella del agente cambia con la forma aunque los nombres sean los mismos", () => {
    expect(huellaDeConfiguracion("voz", ["handoffHuman"], "aaaa0000")).not.toBe(
      huellaDeConfiguracion("voz", ["handoffHuman"], "bbbb1111"),
    );
  });
});
