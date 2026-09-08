/**
 * El correo que llega REENVIADO desde el buzón que el negocio ya usaba.
 *
 * Es la parte con más casos raros del canal: el remitente que trae el sobre
 * ya no es el del cliente final, y equivocarse aquí no da un error visible —
 * da conversaciones de personas distintas mezcladas en una sola, que es de
 * las pocas cosas que no se pueden deshacer.
 */
import { describe, it, expect } from "vitest";
import {
  soloDireccion,
  direcciones,
  esCorreoAutomatico,
  remitenteReal,
  limpiarCuerpoReenviado,
  dirigidoAEsteBot,
} from "../../src/channels/email/reenvio";

const BUZON = "soporte@empresa.com";

describe("soloDireccion", () => {
  it("saca la dirección de un remitente con nombre", () => {
    expect(soloDireccion("Ana Ruiz <ana@x.com>")).toBe("ana@x.com");
  });

  it("normaliza a minúsculas — la misma persona no puede ser dos conversaciones", () => {
    expect(soloDireccion("Ana@X.COM")).toBe("ana@x.com");
    expect(soloDireccion("  <Ana@X.com>  ")).toBe("ana@x.com");
  });

  // Un valor sin arroba terminaría siendo la identidad de una conversación.
  it("lo que no es una dirección devuelve vacío, no basura", () => {
    expect(soloDireccion("no proporcionado")).toBe("");
    expect(soloDireccion("")).toBe("");
    expect(soloDireccion(null)).toBe("");
    expect(soloDireccion(undefined)).toBe("");
  });
});

describe("direcciones", () => {
  it("separa una lista y descarta lo que no sirve", () => {
    expect(direcciones("a@x.com, Ana <b@x.com>, basura")).toEqual(["a@x.com", "b@x.com"]);
  });

  it("acepta que ya venga como arreglo", () => {
    expect(direcciones(["A@X.com", "b@x.com"])).toEqual(["a@x.com", "b@x.com"]);
  });
});

/**
 * Un "estoy de vacaciones" o un rebote también se reenvían. Si el bot les
 * contesta, la respuesta puede disparar otro automático: un ciclo que quema
 * créditos y llena de correo a alguien que no pidió nada.
 */
describe("esCorreoAutomatico", () => {
  it("respeta Auto-Submitted (RFC 3834)", () => {
    expect(esCorreoAutomatico("ana@x.com", { "auto-submitted": "auto-replied" })).toBe(true);
    expect(esCorreoAutomatico("ana@x.com", { "auto-submitted": "auto-generated" })).toBe(true);
  });

  // "no" es el valor que marca un correo escrito por una persona.
  it("Auto-Submitted: no NO es automático", () => {
    expect(esCorreoAutomatico("ana@x.com", { "auto-submitted": "no" })).toBe(false);
  });

  it("atrapa las variantes que usan los proveedores que no siguen el RFC", () => {
    expect(esCorreoAutomatico("ana@x.com", { precedence: "bulk" })).toBe(true);
    expect(esCorreoAutomatico("ana@x.com", { precedence: "auto_reply" })).toBe(true);
    expect(esCorreoAutomatico("ana@x.com", { "x-autoreply": "yes" })).toBe(true);
    expect(esCorreoAutomatico("ana@x.com", { "list-id": "<boletin.x.com>" })).toBe(true);
    expect(esCorreoAutomatico("ana@x.com", { "list-unsubscribe": "<https://x.com/baja>" })).toBe(true);
  });

  it("un rebote no lleva a ninguna persona", () => {
    expect(esCorreoAutomatico("MAILER-DAEMON@x.com", {})).toBe(true);
    expect(esCorreoAutomatico("postmaster@x.com", {})).toBe(true);
    expect(esCorreoAutomatico("no-reply@x.com", {})).toBe(true);
    expect(esCorreoAutomatico("noreply@x.com", {})).toBe(true);
  });

  it("un cliente normal pasa", () => {
    expect(esCorreoAutomatico("Ana <ana@x.com>", {})).toBe(false);
    expect(esCorreoAutomatico("ana@x.com", { subject: "Cotización" })).toBe(false);
  });
});

describe("remitenteReal", () => {
  // El caso normal: Gmail y Microsoft conservan el From original al reenviar.
  it("si el reenvío conservó el remitente, ese manda y no se adivina nada", () => {
    expect(remitenteReal({ from: "Ana <ana@x.com>" }, BUZON)).toBe("ana@x.com");
  });

  // El caso peligroso: sin esto, el buzón del negocio sería la identidad de
  // la conversación y TODOS sus clientes caerían en la misma.
  it("si el From es el buzón del negocio, lo saca del Reply-To", () => {
    const r = remitenteReal(
      { from: "Soporte <soporte@empresa.com>", replyTo: "Ana <ana@x.com>" },
      BUZON,
    );
    expect(r).toBe("ana@x.com");
  });

  it("y si no, de las cabeceras que dejan los reenviadores", () => {
    for (const nombre of ["x-original-from", "x-original-sender", "x-forwarded-for", "x-envelope-from", "return-path"]) {
      const r = remitenteReal({ from: BUZON, headers: { [nombre]: "Ana <ana@x.com>" } }, BUZON);
      expect(r, `cabecera ${nombre}`).toBe("ana@x.com");
    }
  });

  it("último recurso: el From que Gmail escribe dentro del cuerpo", () => {
    const cuerpo = [
      "Les reenvío esto.",
      "",
      "---------- Forwarded message ---------",
      "From: Ana Ruiz <ana@x.com>",
      "Date: mar, 8 sept 2026",
      "Subject: Cotización",
      "",
      "Hola, quiero cotizar.",
    ].join("\n");
    expect(remitenteReal({ from: BUZON, text: cuerpo }, BUZON)).toBe("ana@x.com");
  });

  it("también en español", () => {
    const cuerpo = ["--------- Mensaje reenviado ---------", "De: Ana <ana@x.com>", "", "Hola"].join("\n");
    expect(remitenteReal({ from: BUZON, text: cuerpo }, BUZON)).toBe("ana@x.com");
  });

  // Preferir "" a inventar: quien llama descarta el correo en vez de crear
  // una conversación con una identidad falsa.
  it("si no se puede saber quién escribió, devuelve vacío en vez de adivinar", () => {
    expect(remitenteReal({ from: BUZON }, BUZON)).toBe("");
    expect(remitenteReal({ from: BUZON, replyTo: BUZON }, BUZON)).toBe("");
    expect(remitenteReal({ from: BUZON, text: "sin bloque de reenvío" }, BUZON)).toBe("");
  });

  it("sin buzón configurado se respeta el From tal cual — es el comportamiento de siempre", () => {
    expect(remitenteReal({ from: "Ana <ana@x.com>" }, null)).toBe("ana@x.com");
    expect(remitenteReal({ from: "Ana <ana@x.com>" }, "")).toBe("ana@x.com");
  });
});

describe("limpiarCuerpoReenviado", () => {
  it("quita el encabezado del reenvío y deja lo que el cliente escribió", () => {
    const cuerpo = [
      "---------- Forwarded message ---------",
      "From: Ana Ruiz <ana@x.com>",
      "Date: mar, 8 sept 2026 a las 9:15",
      "Subject: Cotización",
      "To: <soporte@empresa.com>",
      "",
      "Hola, quiero cotizar 200 piezas.",
      "Gracias.",
    ].join("\n");
    expect(limpiarCuerpoReenviado(cuerpo)).toBe("Hola, quiero cotizar 200 piezas.\nGracias.");
  });

  it("un correo normal no se toca", () => {
    expect(limpiarCuerpoReenviado("  Hola, quiero cotizar.  ")).toBe("Hola, quiero cotizar.");
  });

  // Mejor poca señal que ninguna.
  it("un reenvío sin cuerpo devuelve lo original en vez de quedar vacío", () => {
    const soloEncabezado = "---------- Forwarded message ---------\nFrom: Ana <ana@x.com>";
    expect(limpiarCuerpoReenviado(soloEncabezado)).toBe(soloEncabezado);
  });
});

/**
 * El webhook de Resend es de CUENTA, no de bot: no se puede filtrar por
 * dirección al suscribirlo, así que cada bot conectado recibe TODOS los
 * correos. Sin este filtro, con dos bots en el mismo despliegue el correo de
 * un cliente aparece en la conversación del otro.
 */
describe("dirigidoAEsteBot", () => {
  it("acepta el correo cuya dirección de entrada es la suya", () => {
    expect(dirigidoAEsteBot(["bot-a@mail.nodia.io"], "bot-a@mail.nodia.io")).toBe(true);
    expect(dirigidoAEsteBot(["Otro <otro@x.com>", "BOT-A@mail.nodia.io"], "bot-a@mail.nodia.io")).toBe(true);
  });

  it("descarta el del otro bot", () => {
    expect(dirigidoAEsteBot(["bot-b@mail.nodia.io"], "bot-a@mail.nodia.io")).toBe(false);
  });

  // Sin dirección configurada = un solo bot. Exigirla rompería las
  // instalaciones que hoy funcionan.
  it("sin dirección configurada acepta todo", () => {
    expect(dirigidoAEsteBot(["lo-que-sea@x.com"], null)).toBe(true);
    expect(dirigidoAEsteBot([], "")).toBe(true);
  });
});
