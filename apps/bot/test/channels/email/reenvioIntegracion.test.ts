/**
 * El canal de correo cuando el negocio NO cambia su MX, sino que REENVÍA
 * desde el buzón que ya usaba.
 *
 * Aquí se prueba el cableado completo, no las funciones sueltas (eso está en
 * test/channels/emailReenvio.test.ts): que el parser descarte lo que no debe
 * llegarle al agente, que recupere al cliente real detrás del reenvío, y que
 * la respuesta salga desde el buzón del negocio y dentro del hilo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseResendInbound } from "../../../src/channels/email/resend";
import { parseMailgunInbound } from "../../../src/channels/email/mailgun";
import {
  asuntoDeRespuesta,
  cabecerasDeHilo,
  sendOutboundEmail,
} from "../../../src/channels/email/outbound";
import type { Env } from "../../../src/env";

const BUZON = "soporte@empresa.com";
const ENTRADA = "bot-a@mail.nodia.io";
const OPTS = { buzonDeAtencion: BUZON, direccionDeEntrada: ENTRADA };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** El webhook de Resend solo trae metadata; el cuerpo se pide aparte con la API key. */
function resendResponde(correo: Record<string, unknown>) {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(correo), { status: 200 })) as any;
}

const sobre = JSON.stringify({ type: "email.received", data: { email_id: "em_1" } });

describe("parseResendInbound — correo reenviado desde el buzón del negocio", () => {
  it("recupera al cliente real y limpia el encabezado del reenvío", async () => {
    resendResponde({
      from: `Soporte <${BUZON}>`,
      to: [ENTRADA],
      subject: "Cotización",
      reply_to: "Ana Ruiz <ana@x.com>",
      message_id: "<abc@mail.gmail.com>",
      text: [
        "---------- Forwarded message ---------",
        "From: Ana Ruiz <ana@x.com>",
        "Subject: Cotización",
        "",
        "Hola, quiero cotizar 200 piezas.",
      ].join("\n"),
    });

    const msg = await parseResendInbound(sobre, "re_x", OPTS);

    // Lo que importa: la conversación es de ANA, no del buzón de la empresa.
    expect(msg?.channelUserId).toBe("ana@x.com");
    expect(msg?.text).toContain("Hola, quiero cotizar 200 piezas.");
    expect(msg?.text).not.toContain("Forwarded message");
    expect(msg?.emailThread).toEqual({ subject: "Cotización", messageId: "<abc@mail.gmail.com>" });
  });

  it("un correo directo (sin reenvío) sigue funcionando igual que antes", async () => {
    resendResponde({ from: "Ana <ana@x.com>", to: [ENTRADA], subject: "Hola", text: "Buenos días" });
    const msg = await parseResendInbound(sobre, "re_x", OPTS);
    expect(msg?.channelUserId).toBe("ana@x.com");
    expect(msg?.text).toBe("Asunto: Hola\n\nBuenos días");
  });

  // El webhook de Resend es de CUENTA: cada bot recibe TODOS los correos.
  it("descarta el correo dirigido a OTRO bot", async () => {
    resendResponde({ from: "Ana <ana@x.com>", to: ["bot-b@mail.nodia.io"], subject: "Hola", text: "x" });
    expect(await parseResendInbound(sobre, "re_x", OPTS)).toBeNull();
  });

  // El escenario REAL de producción: el proveedor reenvía asesor@kontrolia.io
  // hacia asesor@…resend.app. El To: sigue diciendo el buzón del negocio y la
  // dirección de Resend solo aparece en Delivered-To. Comparar únicamente
  // contra la de entrada habría descartado TODOS los correos, en silencio.
  it("un reenviado cuyo To sigue siendo el buzón del negocio SÍ entra", async () => {
    resendResponde({
      from: "Ana <ana@x.com>",
      to: [BUZON],
      headers: { "Delivered-To": ENTRADA },
      subject: "Cotización",
      text: "Quiero cotizar.",
    });
    expect((await parseResendInbound(sobre, "re_x", OPTS))?.channelUserId).toBe("ana@x.com");
  });

  it("y si el proveedor sí reescribe el To, también", async () => {
    resendResponde({ from: "Ana <ana@x.com>", to: [ENTRADA], subject: "x", text: "y" });
    expect((await parseResendInbound(sobre, "re_x", OPTS))?.channelUserId).toBe("ana@x.com");
  });

  it("sin dirección de entrada configurada acepta todo — es el caso de un solo bot", async () => {
    resendResponde({ from: "Ana <ana@x.com>", to: ["lo-que-sea@x.com"], subject: "Hola", text: "x" });
    const msg = await parseResendInbound(sobre, "re_x", { buzonDeAtencion: BUZON });
    expect(msg?.channelUserId).toBe("ana@x.com");
  });

  // Contestarle a un autorespondedor puede disparar otro automático: un ciclo
  // que quema créditos y llena de correo a alguien que no pidió nada.
  it("descarta los automáticos y los rebotes", async () => {
    resendResponde({
      from: "Ana <ana@x.com>",
      to: [ENTRADA],
      subject: "Fuera de la oficina",
      text: "Estoy de vacaciones",
      headers: { "Auto-Submitted": "auto-replied" },
    });
    expect(await parseResendInbound(sobre, "re_x", OPTS)).toBeNull();

    resendResponde({ from: "MAILER-DAEMON@x.com", to: [ENTRADA], subject: "Undelivered", text: "fallo" });
    expect(await parseResendInbound(sobre, "re_x", OPTS)).toBeNull();
  });

  // Preferir callar a abrir una conversación con una identidad falsa: si el
  // buzón del negocio fuera el channelUserId, TODOS sus clientes caerían en
  // la misma conversación.
  it("si no se puede saber quién escribió, no inventa una conversación", async () => {
    resendResponde({ from: `Soporte <${BUZON}>`, to: [ENTRADA], subject: "Reenvío", text: "sin pistas" });
    expect(await parseResendInbound(sobre, "re_x", OPTS)).toBeNull();
  });

  it("acepta las cabeceras venga como objeto o como lista", async () => {
    resendResponde({
      from: BUZON,
      to: [ENTRADA],
      subject: "x",
      text: "y",
      headers: [{ name: "X-Original-From", value: "Ana <ana@x.com>" }],
    });
    expect((await parseResendInbound(sobre, "re_x", OPTS))?.channelUserId).toBe("ana@x.com");
  });
});

/** Mailgun tiene que comportarse IGUAL: si no, cambiar de proveedor cambia el bot. */
describe("parseMailgunInbound — las mismas reglas", () => {
  const form = (campos: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(campos)) f.append(k, v);
    return f;
  };

  it("recupera al cliente real detrás del reenvío", () => {
    const msg = parseMailgunInbound(
      form({
        sender: BUZON,
        recipient: ENTRADA,
        subject: "Cotización",
        "stripped-text": "---------- Forwarded message ---------\nFrom: Ana <ana@x.com>\n\nQuiero cotizar.",
        "message-headers": JSON.stringify([["Message-Id", "<m1@x.com>"]]),
      }),
      OPTS,
    );
    expect(msg?.channelUserId).toBe("ana@x.com");
    expect(msg?.emailThread?.messageId).toBe("<m1@x.com>");
  });

  it("descarta el de otro bot y los automáticos", () => {
    expect(
      parseMailgunInbound(form({ sender: "ana@x.com", recipient: "bot-b@mail.nodia.io", "stripped-text": "x" }), OPTS),
    ).toBeNull();
    expect(
      parseMailgunInbound(
        form({
          sender: "ana@x.com",
          recipient: ENTRADA,
          "stripped-text": "x",
          "message-headers": JSON.stringify([["Precedence", "bulk"]]),
        }),
        OPTS,
      ),
    ).toBeNull();
  });

  it("cabeceras ilegibles no tumban el correo — se pierde la detección, no el mensaje", () => {
    const msg = parseMailgunInbound(
      form({ sender: "ana@x.com", recipient: ENTRADA, "stripped-text": "hola", "message-headers": "{roto" }),
      OPTS,
    );
    expect(msg?.channelUserId).toBe("ana@x.com");
  });
});

describe("asuntoDeRespuesta", () => {
  it("responde dentro del hilo con el asunto del cliente", () => {
    expect(asuntoDeRespuesta("Cotización")).toBe("Re: Cotización");
  });

  it("no apila Re: sobre Re:", () => {
    expect(asuntoDeRespuesta("Re: Cotización")).toBe("Re: Cotización");
    expect(asuntoDeRespuesta("RE:Cotización")).toBe("RE:Cotización");
  });

  it("sin asunto cae a un texto genérico en vez de mandar uno vacío", () => {
    expect(asuntoDeRespuesta(undefined)).toBe("Re: tu mensaje");
    expect(asuntoDeRespuesta("   ")).toBe("Re: tu mensaje");
  });
});

describe("cabecerasDeHilo", () => {
  it("engancha la respuesta al correo original", () => {
    expect(cabecerasDeHilo({ messageId: "<abc@x.com>" })).toEqual({
      "In-Reply-To": "<abc@x.com>",
      References: "<abc@x.com>",
    });
  });

  it("le pone los ángulos si vienen sin ellos", () => {
    expect(cabecerasDeHilo({ messageId: "abc@x.com" })["In-Reply-To"]).toBe("<abc@x.com>");
  });

  it("sin Message-ID no manda cabeceras vacías", () => {
    expect(cabecerasDeHilo(undefined)).toEqual({});
    expect(cabecerasDeHilo({ subject: "x" })).toEqual({});
  });
});

/**
 * El bot escribe DESDE el buzón que el negocio ya usaba, así que el circuito
 * cierra sin Reply-To: un correo sin esa cabecera se responde al From, la
 * respuesta llega al buzón del negocio, y su reenvío la trae de vuelta.
 */
describe("salida — se escribe desde el buzón del negocio, y dentro del hilo", () => {
  const env = {
    EMAIL_OUTBOUND_PROVIDER: "mailgun",
    EMAIL_OUTBOUND_API_KEY: "key-x",
    EMAIL_OUTBOUND_DOMAIN: "minegocio.com",
    EMAIL_FROM_ADDRESS: BUZON,
    EMAIL_FROM_NAME: "Soporte Mi Negocio",
  } as unknown as Env;

  function capturarEnvio() {
    const capturado = { body: new URLSearchParams() };
    globalThis.fetch = vi.fn(async (_url: any, init: any) => {
      capturado.body = new URLSearchParams(init.body as string);
      return new Response("{}", { status: 200 });
    }) as any;
    return capturado;
  }

  it("el correo sale del buzón del negocio y con las cabeceras del hilo", async () => {
    const capturado = capturarEnvio();

    const r = await sendOutboundEmail(env, "ana@x.com", "Re: Cotización", "Claro que sí.", {
      subject: "Cotización",
      messageId: "<abc@x.com>",
    });

    expect(r.ok).toBe(true);
    expect(capturado.body.get("from")).toBe(`Soporte Mi Negocio <${BUZON}>`);
    expect(capturado.body.get("h:In-Reply-To")).toBe("<abc@x.com>");
    expect(capturado.body.get("subject")).toBe("Re: Cotización");
  });

  // Un Reply-To igual al From es ruido, y pedirlo aparte en el panel era
  // pedir dos veces el mismo dato.
  it("NO manda Reply-To: responder al From ya llega al buzón correcto", async () => {
    const capturado = capturarEnvio();
    await sendOutboundEmail(env, "ana@x.com", "Re: x", "y", { messageId: "<abc@x.com>" });
    expect(capturado.body.has("h:Reply-To")).toBe(false);
  });

  it("sin hilo no manda cabeceras vacías", async () => {
    const capturado = capturarEnvio();
    await sendOutboundEmail(env, "ana@x.com", "Re: x", "y");
    expect(capturado.body.has("h:In-Reply-To")).toBe(false);
    expect(capturado.body.has("h:References")).toBe(false);
  });
});
