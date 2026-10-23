// Puras, sin base: qué le dice al bot el bloque <canal>. Ver src/agent/canal.ts.
import { describe, it, expect } from "vitest";
import { bloqueDeCanal, paginaSegura } from "../../src/agent/canal";

describe("bloqueDeCanal", () => {
  // El caso real: el bot le pidió el correo a quien le acababa de escribir por correo.
  it("correo: le da el remitente y le dice que no lo pida", () => {
    const b = bloqueDeCanal({ channel: "email", channelUserId: "raul.dolores@gmail.com" })!;
    expect(b).toContain("raul.dolores@gmail.com");
    expect(b).toContain("no se lo pidas");
  });

  it("WhatsApp (Twilio, Cloud o Kapso): el número, con +", () => {
    for (const channel of ["twilio", "whatsapp", "kapso"]) {
      const b = bloqueDeCanal({ channel, channelUserId: "5215545562046" })!;
      expect(b).toContain("WhatsApp desde el número +5215545562046");
    }
  });

  it("WhatsApp sin número (identidad BSUID): no inventa uno", () => {
    const b = bloqueDeCanal({ channel: "whatsapp", channelUserId: "MX.abc123XYZ" })!;
    expect(b).toContain("su número no viene");
    expect(b).not.toContain("MX.abc123XYZ");
  });

  it("llamada: el número de quien llama, o que viene oculto", () => {
    expect(bloqueDeCanal({ channel: "voice", channelUserId: "+525588974627" })).toContain("+525588974627");
    expect(bloqueDeCanal({ channel: "voice", channelUserId: "anonymous" })).toContain("número oculto");
  });

  it("widget: sin teléfono ni correo, pero con la página donde abrió el chat", () => {
    const b = bloqueDeCanal({ channel: "widget", channelUserId: "uuid-de-sesion", paginaDelWidget: "https://app.aduaniax.com/dashboard/ayuda" })!;
    expect(b).toContain("chat del sitio web");
    expect(b).toContain("no te da su teléfono ni su correo");
    expect(b).toContain("https://app.aduaniax.com/dashboard/ayuda");
    expect(b).not.toContain("uuid-de-sesion");
  });

  it("Telegram: el id del chat no es un teléfono y no se presenta como tal", () => {
    const b = bloqueDeCanal({ channel: "telegram", channelUserId: "123456789" })!;
    expect(b).toContain("Telegram");
    expect(b).not.toContain("123456789");
  });

  it("canal desconocido: nada", () => {
    expect(bloqueDeCanal({ channel: "entrenamiento", channelUserId: "x" })).toBeNull();
  });
});

describe("paginaSegura", () => {
  it("se queda con origen + ruta: la query y el hash pueden traer tokens", () => {
    expect(paginaSegura("https://app.x.com/reset?token=SECRETO#a")).toBe("https://app.x.com/reset");
  });
  it("nada que no sea http(s)", () => {
    expect(paginaSegura("javascript:alert(1)")).toBeUndefined();
    expect(paginaSegura("no es url")).toBeUndefined();
    expect(paginaSegura(undefined)).toBeUndefined();
  });
});
