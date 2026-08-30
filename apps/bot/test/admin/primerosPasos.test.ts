// Primeros pasos — la guía que ve alguien que acaba de instalar esto.
//
// Lo que se protege: que la guía APAREZCA cuando falta algo y DESAPAREZCA
// cuando no. Los dos errores duelen: si no aparece, el dueño se queda con un
// bot mudo sin saber por qué; si no desaparece, le queda una tarea pendiente
// para siempre en un panel que ya funciona.
import { describe, it, expect } from "vitest";
import {
  renderPrimerosPasos,
  renderYaOpera,
  type EstadoPrimerosPasos,
} from "../../src/admin/views/primerosPasos";

function estado(over: Partial<EstadoPrimerosPasos> = {}): EstadoPrimerosPasos {
  const pasos = [
    { id: "negocio" as const, titulo: "Cuéntale de tu negocio", porQue: "…", hecho: false, cta: { label: "Llenar", href: "/admin/config" } },
    { id: "canal" as const, titulo: "Conéctalo a Telegram", porQue: "…", hecho: false, cta: { label: "Conectar", href: "/admin/conexiones" } },
    { id: "prueba" as const, titulo: "Escríbele", porQue: "…", hecho: false, cta: { label: "Probar", href: "/admin/entrenamiento" } },
  ];
  const completos = pasos.filter((p) => p.hecho).length;
  return { pasos, completos, listo: completos === pasos.length, canalConectado: null, mensajesReales: 0, ...over };
}

/** Marca los primeros n pasos como hechos y recalcula. */
function conHechos(n: number, over: Partial<EstadoPrimerosPasos> = {}): EstadoPrimerosPasos {
  const base = estado();
  const pasos = base.pasos.map((p, i) => ({ ...p, hecho: i < n }));
  const completos = pasos.filter((p) => p.hecho).length;
  return { ...base, pasos, completos, listo: completos === pasos.length, ...over };
}

describe("la guía aparece mientras falte algo", () => {
  it("con todo pendiente, se muestra y marca 0%", () => {
    const html = renderPrimerosPasos(estado(), "Sofía");
    expect(html).toContain("Sofía");
    expect(html).toContain("0%");
    expect(html).toContain("Faltan 3 de 3");
  });

  it("va reflejando el avance", () => {
    expect(renderPrimerosPasos(conHechos(1), "Sofía")).toContain("33%");
    expect(renderPrimerosPasos(conHechos(2), "Sofía")).toContain("67%");
  });

  // Tres botones iguales no guían, solo ofrecen opciones. El SIGUIENTE paso es
  // el único con botón lleno; los demás quedan como enlace discreto.
  it("solo el siguiente paso pendiente lleva el botón principal", () => {
    const html = renderPrimerosPasos(conHechos(1), "Sofía");
    const botones = html.match(/background:var\(--accent\);border:1px solid var\(--accent\)/g) ?? [];
    expect(botones).toHaveLength(1);
    // Y es el del paso 2 (canal), no el del 3.
    const posCanal = html.indexOf("/admin/conexiones");
    const posBoton = html.indexOf("background:var(--accent);border:1px solid var(--accent)");
    expect(Math.abs(posCanal - posBoton)).toBeLessThan(400);
  });

  it("un paso ya hecho se tacha y deja de explicarse", () => {
    const html = renderPrimerosPasos(conHechos(1), "Sofía");
    expect(html).toContain("line-through");
  });
});

describe("la guía desaparece sola", () => {
  it("con los 3 pasos hechos ya no se renderiza — no hay que cerrarla", () => {
    expect(renderPrimerosPasos(conHechos(3), "Sofía")).toBe("");
  });

  it("el cierre solo sale cuando ya está operando", () => {
    expect(renderYaOpera(conHechos(2), "Sofía")).toBe("");
    expect(renderYaOpera(conHechos(3, { canalConectado: "telegram" }), "Sofía")).toContain("Telegram");
  });

  // Sin este corte, el panel felicitaría por algo que pasó hace meses cada vez
  // que el dueño entra.
  it("el cierre se apaga solo con el uso, sin guardar un 'ya lo vi'", () => {
    const recien = conHechos(3, { canalConectado: "telegram", mensajesReales: 3 });
    const rodado = conHechos(3, { canalConectado: "telegram", mensajesReales: 500 });
    expect(renderYaOpera(recien, "Sofía")).not.toBe("");
    expect(renderYaOpera(rodado, "Sofía")).toBe("");
  });

  it("nombra el canal que de verdad conectó, no siempre Telegram", () => {
    expect(renderYaOpera(conHechos(3, { canalConectado: "twilio" }), "Sofía")).toContain("WhatsApp");
    expect(renderYaOpera(conHechos(3, { canalConectado: "email" }), "Sofía")).toContain("correo");
    // Un canal desconocido no rompe el texto.
    expect(renderYaOpera(conHechos(3, { canalConectado: "raro" }), "Sofía")).toContain("tu canal");
  });
});

describe("seguridad del render", () => {
  it("escapa el nombre del bot (lo escribe el dueño)", () => {
    const html = renderPrimerosPasos(estado(), '<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});
