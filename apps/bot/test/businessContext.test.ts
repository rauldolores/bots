import { describe, it, expect } from "vitest";
import { renderBusinessContext } from "../src/businessContext";
import type { BotConfig } from "../src/db/bots";

// Fixture propio, no depende de datos reales de ningún bot.
const FIXTURE: BotConfig = {
  hours: "Lunes a sábado de 10 a 8",
  services: [
    { name: "Corte", price: 250 },
    { name: "Barba", price: 200 },
    { name: "Corte + Barba", price: 400 },
  ],
  location: "Av. Reforma 123, CDMX",
  paymentMethods: ["efectivo", "transferencia", "tarjeta"],
  contactPhone: "+52 55 1234 5678",
  website: "https://barberia.example.com",
  customFields: { Estacionamiento: "sí, gratis" },
} as BotConfig;

describe("renderBusinessContext", () => {
  it("renders hours, services with prices, location, payment, phone, website", () => {
    const ctx = renderBusinessContext(FIXTURE);
    expect(ctx).toContain("Horarios:");
    expect(ctx).toContain("Servicios y precios:");
    expect(ctx).toContain("Corte: $250");
    expect(ctx).toContain("Barba: $200");
    expect(ctx).toContain("Corte + Barba: $400");
    expect(ctx).toContain("Ubicación:");
    expect(ctx).toContain("Métodos de pago:");
    expect(ctx).toContain("Teléfono:");
    expect(ctx).toContain("Sitio web: https://barberia.example.com");
  });

  it("website ausente no deja una línea vacía", () => {
    const ctx = renderBusinessContext({ hours: "Lun-Vie 9-6" } as BotConfig);
    expect(ctx).not.toContain("Sitio web");
  });

  it("joins payment methods with comma", () => {
    const ctx = renderBusinessContext(FIXTURE);
    expect(ctx).toContain("efectivo, transferencia, tarjeta");
  });

  // `services` es el campo VIEJO que llenaba el skill de onboarding sin que
  // ningún campo del panel lo mostrara nunca (bug real reportado: datos que
  // ni el dueño podía ver ni quitar). `catalog` es lo que administra
  // /admin/config → "Catálogo" hoy — si ya existe, gana; `services` solo es
  // respaldo para quien aún no haya guardado /admin/config desde este fix.
  it("catalog gana sobre el legacy services cuando ambos existen — nunca se muestran juntos", () => {
    const ctx = renderBusinessContext({
      catalog: [{ name: "Consultoría", price: 5000 }],
      services: [{ name: "Corte", price: 250 }],
    } as BotConfig);
    expect(ctx).toContain("Consultoría: $5000");
    expect(ctx).not.toContain("Corte");
  });

  it("sin catalog, cae al legacy services (compatibilidad con bots que no han migrado)", () => {
    const ctx = renderBusinessContext({ services: [{ name: "Corte", price: 250 }] } as BotConfig);
    expect(ctx).toContain("Corte: $250");
  });
});
