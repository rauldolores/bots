/**
 * El mismo humano llega hoy en cuatro formatos distintos y nada los cruzaba.
 * Estas pruebas fijan que a partir de ahora todos caen en el mismo canónico.
 */
import { describe, it, expect } from "vitest";
import {
  normalizePhone,
  normalizeEmail,
  classifyContact,
  phoneVariants,
  stripWhatsappPrefix,
  regionForTimezone,
} from "../../src/contacts/normalize";

describe("normalizePhone — el caso que motiva la dependencia", () => {
  it("las formas reales del MISMO celular mexicano caen todas en el mismo E.164", () => {
    const canonico = "+525512345678";
    // Twilio (WhatsApp), con el 1 móvil y con +
    expect(normalizePhone("+5215512345678")).toBe(canonico);
    // WhatsApp Cloud API: sin +, con el 1
    expect(normalizePhone("5215512345678")).toBe(canonico);
    // Voz / ya canónico
    expect(normalizePhone("+525512345678")).toBe(canonico);
    // Lo que escribiría el LLM en leads.contact
    expect(normalizePhone("55 1234 5678")).toBe(canonico);
    expect(normalizePhone("(55) 1234-5678")).toBe(canonico);
    // Con el prefijo de Twilio pegado
    expect(normalizePhone("whatsapp:+5215512345678")).toBe(canonico);
  });

  it("respeta el país del negocio para números escritos sin lada", () => {
    expect(normalizePhone("212 555 0182", "US")).toBe("+12125550182");
    // El mismo texto interpretado como mexicano NO es válido.
    expect(normalizePhone("212 555 0182", "MX")).not.toBe("+12125550182");
  });

  it("devuelve null en vez de inventar cuando no es un teléfono", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("no soy un teléfono")).toBeNull();
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("ana@ejemplo.com")).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("baja a minúsculas y recorta", () => {
    expect(normalizeEmail("  Ana.Robles@Ejemplo.COM ")).toBe("ana.robles@ejemplo.com");
  });

  it("rechaza lo que no es correo", () => {
    expect(normalizeEmail("ana@")).toBeNull();
    expect(normalizeEmail("ana ejemplo.com")).toBeNull();
    expect(normalizeEmail("+525512345678")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
});

describe("classifyContact — una sola columna de texto libre, tipada de una vez", () => {
  it("distingue correo de teléfono", () => {
    expect(classifyContact("ANA@x.com")).toEqual({
      kind: "email",
      addressRaw: "ANA@x.com",
      addressNorm: "ana@x.com",
    });
    expect(classifyContact("55 1234 5678")).toEqual({
      kind: "phone",
      addressRaw: "55 1234 5678",
      addressNorm: "+525512345678",
    });
  });

  it("null cuando no se puede contactar — mejor nada que un contacto inútil", () => {
    expect(classifyContact("me llamo Ana")).toBeNull();
    expect(classifyContact("")).toBeNull();
    expect(classifyContact(undefined)).toBeNull();
  });
});

describe("phoneVariants — para cruzar un lead con conversaciones ya existentes", () => {
  it("incluye la forma de WhatsApp con el 1 mexicano", () => {
    const v = phoneVariants("+525512345678");
    expect(v).toContain("+525512345678");
    expect(v).toContain("525512345678");
    expect(v).toContain("5215512345678"); // como lo guarda WhatsApp Cloud
    expect(v).toContain("+5215512345678"); // como lo guarda Twilio
  });

  it("y también al revés, desde la forma con 1", () => {
    const v = phoneVariants("+5215512345678");
    expect(v).toContain("525512345678");
    expect(v).toContain("+525512345678");
  });

  it("un número no mexicano no inventa variantes de más", () => {
    expect(phoneVariants("+12125550182").sort()).toEqual(["+12125550182", "12125550182"]);
  });
});

describe("stripWhatsappPrefix", () => {
  it("quita el prefijo sin tocar el resto", () => {
    expect(stripWhatsappPrefix("whatsapp:+5215512345678")).toBe("+5215512345678");
    expect(stripWhatsappPrefix("+5215512345678")).toBe("+5215512345678");
  });
});

describe("regionForTimezone", () => {
  it("saca el país de la zona horaria, que sí es una lista cerrada", () => {
    expect(regionForTimezone("America/Mexico_City")).toBe("MX");
    expect(regionForTimezone("America/Tijuana")).toBe("MX");
    expect(regionForTimezone("America/New_York")).toBe("US");
    expect(regionForTimezone("Europe/Madrid")).toBe("ES");
    expect(regionForTimezone("America/Argentina/Buenos_Aires")).toBe("AR");
  });

  it("cae a México cuando no hay zona o no la conoce", () => {
    expect(regionForTimezone(null)).toBe("MX");
    expect(regionForTimezone("UTC")).toBe("MX");
  });
});
