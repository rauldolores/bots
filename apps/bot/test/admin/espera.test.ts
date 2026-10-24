// Puras, sin base: toda pantalla del panel trae la retroalimentación de
// "guardando…" (ver ESPERA_SCRIPT en src/admin/views/layout.ts). Va en el
// layout, así que basta con que el layout la incluya una vez.
import { describe, it, expect } from "vitest";
import { layout, loginPage } from "../../src/admin/views/layout";

describe("retroalimentación al guardar", () => {
  it("el layout de todas las pantallas trae el script y sus estilos, una sola vez", () => {
    const html = layout({ title: "X", activeTab: "config", body: "<form method=\"POST\"><button>Guardar</button></form>" });
    expect(html.match(/window\.__nbEspera = true/g)).toHaveLength(1);
    expect(html).toContain("#nb-capa");
    expect(html).toContain("htmx:beforeRequest");
  });

  it("la pantalla de entrada también", () => {
    expect(loginPage()).toContain("window.__nbEspera = true");
  });
});
