/**
 * Panel lateral de ayuda y Novedades — sin base: qué ayuda le toca a cada
 * pantalla, la búsqueda, y que la lista de novedades esté bien formada.
 * El endpoint /admin/ayuda/panel se cubre en ayuda.test.ts (necesita la base).
 */
import { describe, it, expect } from "vitest";
import { ayudaParaRuta, buscarAyuda } from "../../src/admin/help/contexto";
import { NOVEDADES } from "../../src/admin/help/novedades";
import { renderPanelAyuda } from "../../src/admin/views/ayuda";

describe("ayudaParaRuta", () => {
  it("trae el artículo de la pantalla y las preguntas que lo amplían", () => {
    const r = ayudaParaRuta("/admin/leads");
    expect(r.articulos.map((a) => a.id)).toEqual(["leads"]);
    expect(r.preguntas.length).toBeGreaterThan(0);
    for (const p of r.preguntas) expect(p.articulo).toBe("leads");
  });

  it("una subpantalla cae en la de su lista", () => {
    expect(ayudaParaRuta("/admin/conversations/abc-123").articulos[0].id).toBe("conversaciones");
  });

  it("en Configuración, la sección abierta va primero", () => {
    expect(ayudaParaRuta("/admin/config?section=modelo").articulos[0].id).toBe("config-modelo");
    expect(ayudaParaRuta("/admin/config?section=aviso").articulos[0].id).toBe("config-aviso");
  });

  it("una pantalla sin artículo propio recibe los de Primeros pasos", () => {
    const r = ayudaParaRuta("/admin/ayuda");
    expect(r.articulos.map((a) => a.id)).toContain("tres-pasos");
  });

  it("nunca trae más de 6 artículos ni 6 preguntas", () => {
    const r = ayudaParaRuta("/admin/conexiones");
    expect(r.articulos.length).toBeLessThanOrEqual(6);
    expect(r.preguntas.length).toBeLessThanOrEqual(6);
  });
});

describe("buscarAyuda", () => {
  it("encuentra sin acentos ni mayúsculas", () => {
    const r = buscarAyuda("WHATSAPP");
    expect(r.preguntas.length + r.articulos.length).toBeGreaterThan(0);
    expect(buscarAyuda("telefono").articulos.length + buscarAyuda("telefono").preguntas.length).toBeGreaterThan(0);
  });

  it("lo que no existe da vacío", () => {
    const r = buscarAyuda("zzzxxyy");
    expect(r.articulos).toEqual([]);
    expect(r.preguntas).toEqual([]);
  });
});

describe("renderPanelAyuda", () => {
  it("pinta la pantalla, sus preguntas y lo nuevo, sin ids que choquen con /admin/ayuda", () => {
    const html = renderPanelAyuda("/admin/leads", "");
    expect(html).toContain("De esta pantalla");
    expect(html).toContain("Leads");
    expect(html).toContain("Lo nuevo");
    expect(html).toContain(NOVEDADES[0].titulo);
    expect(html).not.toMatch(/<details[^>]* id=/);
    expect(html).not.toContain("ayuda-item");
  });

  it("con búsqueda sin resultados lo dice", () => {
    expect(renderPanelAyuda("/admin/leads", "zzzxxyy")).toContain("No encontramos esa duda");
  });

  it("escapa lo que llega en la búsqueda (no se pinta tal cual)", () => {
    expect(renderPanelAyuda("/admin/leads", "<script>alert(1)</script>")).not.toContain("<script>");
  });
});

describe("NOVEDADES", () => {
  it("tiene novedades, con fecha válida y la más reciente primero", () => {
    expect(NOVEDADES.length).toBeGreaterThan(0);
    for (const n of NOVEDADES) {
      expect(n.fecha, n.titulo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(n.fecha)), n.fecha).toBe(false);
      expect(n.titulo.trim().length).toBeGreaterThan(0);
      expect(n.texto.trim().length).toBeGreaterThan(20);
    }
    const fechas = NOVEDADES.map((n) => n.fecha);
    expect([...fechas].sort().reverse()).toEqual(fechas);
  });

  it("el botón Ir lleva a una pantalla del panel", () => {
    for (const n of NOVEDADES) if (n.ruta) expect(n.ruta.startsWith("/admin/"), n.ruta).toBe(true);
  });
});
