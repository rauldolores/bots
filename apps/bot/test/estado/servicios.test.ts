/**
 * Estado del servicio sin base: el catálogo según el despliegue, el correo al
 * equipo y cómo se pinta lo que está fallando en el panel de ayuda.
 */
import { describe, it, expect } from "vitest";
import { serviciosVigilados } from "../../src/estado/servicios";
import { redactarAviso } from "../../src/estado/revisar";
import { renderPanelAyuda } from "../../src/admin/views/ayuda";
import type { Env } from "../../src/env";

const base = { DASHBOARD_BASE_URL: "https://app.test/" } as unknown as Env;

describe("serviciosVigilados", () => {
  it("las claves son únicas y todos tienen texto para el dueño", () => {
    const s = serviciosVigilados(base);
    expect(new Set(s.map((x) => x.clave)).size).toBe(s.length);
    for (const x of s) {
      expect(x.nombre.length).toBeGreaterThan(3);
      expect(x.descripcion.length).toBeGreaterThan(10);
      expect(x.impacto.endsWith(".")).toBe(true);
    }
  });

  it("el panel se pregunta en su /health, sin la barra final duplicada", () => {
    expect(serviciosVigilados(base).find((x) => x.clave === "panel")?.url).toBe("https://app.test/health");
  });

  it("la voz y KontrolIA solo se vigilan si este despliegue los usa", () => {
    const sin = serviciosVigilados(base);
    expect(sin.find((x) => x.clave === "voz")?.url).toBeNull();
    expect(sin.find((x) => x.clave === "kontrolia")?.url).toBeNull();
    const con = serviciosVigilados({ ...base, VOICE_PUBLIC_BASE_URL: "https://voz.test", OAUTH_CLIENT_ID: "abc" } as Env);
    expect(con.find((x) => x.clave === "voz")?.url).toBe("https://voz.test/health");
    expect(con.find((x) => x.clave === "kontrolia")?.url).toBe("https://auth.kontrolia.io");
  });
});

describe("redactarAviso", () => {
  it("al abrir dice qué falló y el detalle técnico", () => {
    const { subject, text } = redactarAviso([{ clave: "meta", nombre: "WhatsApp, Instagram y Messenger (Meta)", accion: "ABRIO", detalle: "graph → HTTP 503" }]);
    expect(subject).toContain("falla en WhatsApp, Instagram y Messenger (Meta)");
    expect(text).toContain("FALLA · meta: graph → HTTP 503");
  });

  it("al cerrar dice que se recuperó", () => {
    const { subject, text } = redactarAviso([{ clave: "correo", nombre: "Envío de correos", accion: "CERRO", detalle: "HTTP 401" }]);
    expect(subject).toContain("se recuperó Envío de correos");
    expect(text).toContain("RECUPERADO");
  });
});

describe("renderPanelAyuda con una incidencia abierta", () => {
  it("la avisa arriba, escapada, con enlace al estado del servicio", () => {
    const html = renderPanelAyuda("/admin/leads", "", [
      { id: "1", servicio: "telegram", titulo: "Falla en <Telegram>", mensaje: "Ya estamos dando seguimiento.", inicio: 1, fin: null, cierre: null },
    ]);
    expect(html.indexOf("Falla en &lt;Telegram&gt;")).toBeLessThan(html.indexOf("De esta pantalla"));
    expect(html).toContain('href="/admin/ayuda#estado"');
  });

  it("sin incidencias no pinta aviso", () => {
    expect(renderPanelAyuda("/admin/leads", "")).not.toContain("Ver estado del servicio");
  });
});
