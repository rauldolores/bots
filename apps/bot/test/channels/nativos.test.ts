// Fase 3: cada canal entrega los bloques con SU tipo nativo.
//
// Lo que se prueba no es que la petición salga, sino que salga por el método
// correcto: un PDF por sendDocument se ve con ícono, nombre y botón de
// descarga; el mismo PDF por sendMessage es un enlace azul. Es la misma
// llamada HTTP y la diferencia la ve el cliente.
import { describe, it, expect, vi, afterEach } from "vitest";
import { telegramAdapter } from "../../src/channels/telegram";
import { whatsappAdapter } from "../../src/channels/whatsapp";
import { kapsoAdapter } from "../../src/channels/kapso";
import { metaAdapter } from "../../src/channels/meta";
import { twilioAdapter } from "../../src/channels/twilio";
import { manychatAdapter } from "../../src/channels/manychat";
import { componerCorreo } from "../../src/channels/email/channel";
import type { MessagePart } from "../../src/channels/parts";

const FOTO: MessagePart = { kind: "image", url: "https://x/plato.jpg", caption: "Menú de hoy" };
const PDF: MessagePart = {
  kind: "document",
  url: "https://x/carta.pdf",
  filename: "carta-completa.pdf",
};
const VOZ: MessagePart = { kind: "audio", url: "https://x/nota.ogg", transcript: "Ya vamos" };
const ENLACE: MessagePart = { kind: "link", url: "https://maps/x", title: "Cómo llegar" };

/**
 * Captura todas las llamadas a fetch, sin red.
 *
 * Los argumentos se declaran `any[]` a propósito: sin eso el mock queda tipado
 * como "sin parámetros" y leer `calls[n][1]` (el init de la petición, que es
 * justo lo que estas pruebas revisan) no compila.
 */
function espiarFetch() {
  const mock = vi.fn(async (..._args: any[]) => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** El cuerpo JSON de la llamada n. */
function cuerpo(mock: any, n = 0) {
  return JSON.parse(String(mock.mock.calls[n][1].body));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Telegram — un método por bloque", () => {
  const env = { TELEGRAM_BOT_TOKEN: "T" } as any;

  it("la foto va por sendPhoto, con su pie", async () => {
    const f = espiarFetch();
    await telegramAdapter.sendReply(
      { channel: "telegram", channelUserId: "1", parts: [FOTO], interChunkDelayMs: 0 },
      env,
    );
    // La primera llamada es el indicador de "escribiendo".
    const envio = f.mock.calls.find((c: any) => String(c[0]).includes("/sendPhoto"));
    expect(envio).toBeTruthy();
    expect(JSON.parse(String(envio![1].body))).toEqual({
      chat_id: "1",
      photo: "https://x/plato.jpg",
      caption: "Menú de hoy",
    });
  });

  it("el PDF va por sendDocument, no como enlace", async () => {
    const f = espiarFetch();
    await telegramAdapter.sendReply(
      { channel: "telegram", channelUserId: "1", parts: [PDF], interChunkDelayMs: 0 },
      env,
    );
    const urls = f.mock.calls.map((c: any) => String(c[0]));
    expect(urls.some((u: string) => u.includes("/sendDocument"))).toBe(true);
    expect(urls.some((u: string) => u.includes("/sendMessage"))).toBe(false);
  });

  it("el PDF se SUBE con su nombre real, con acentos y espacios", async () => {
    const f = espiarFetch();
    const conAcentos: MessagePart = {
      kind: "document",
      url: "https://x/Menu-de-la-semana.pdf",
      filename: "Menú de la semana.pdf",
      caption: "Aquí va",
    };
    await telegramAdapter.sendReply(
      { channel: "telegram", channelUserId: "1", parts: [conAcentos], interChunkDelayMs: 0 },
      env,
    );

    // Primero se baja el archivo…
    expect(f.mock.calls.some((c: any) => String(c[0]) === "https://x/Menu-de-la-semana.pdf")).toBe(true);
    // …y se sube como multipart, con el nombre que puso el dueño.
    const envio = f.mock.calls.find((c: any) => String(c[0]).includes("/sendDocument"));
    const form = envio![1].body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect((form.get("document") as File).name).toBe("Menú de la semana.pdf");
    expect(form.get("caption")).toBe("Aquí va");
  });

  it("si el archivo no se puede bajar, cae al envío por URL: llega con otro nombre, pero llega", async () => {
    const f = vi.fn(async (url: any) =>
      String(url).startsWith("https://x/")
        ? new Response("no está", { status: 404 })
        : new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", f);
    await telegramAdapter.sendReply(
      { channel: "telegram", channelUserId: "1", parts: [PDF], interChunkDelayMs: 0 },
      env,
    );
    const envio = (f.mock.calls as any[]).find((c) => String(c[0]).includes("/sendDocument"));
    expect(JSON.parse(String(envio[1].body)).document).toBe("https://x/carta.pdf");
  });

  it("la nota de voz va por sendVoice", async () => {
    const f = espiarFetch();
    await telegramAdapter.sendReply(
      { channel: "telegram", channelUserId: "1", parts: [VOZ], interChunkDelayMs: 0 },
      env,
    );
    expect(f.mock.calls.some((c: any) => String(c[0]).includes("/sendVoice"))).toBe(true);
  });

  it("lo que todavía no es nativo (un enlace) degrada a texto", async () => {
    const f = espiarFetch();
    await telegramAdapter.sendReply(
      { channel: "telegram", channelUserId: "1", parts: [ENLACE], interChunkDelayMs: 0 },
      env,
    );
    const envio = f.mock.calls.find((c: any) => String(c[0]).includes("/sendMessage"));
    expect(JSON.parse(String(envio![1].body)).text).toContain("https://maps/x");
  });
});

describe("WhatsApp Cloud — el nombre del archivo es lo que lo hace archivo", () => {
  const env = { WHATSAPP_PHONE_NUMBER_ID: "P", WHATSAPP_ACCESS_TOKEN: "T" } as any;

  it("el documento viaja con filename", async () => {
    const f = espiarFetch();
    await whatsappAdapter.sendReply(
      { channel: "whatsapp", channelUserId: "52155", parts: [PDF], interChunkDelayMs: 0 },
      env,
    );
    expect(cuerpo(f)).toMatchObject({
      type: "document",
      document: { link: "https://x/carta.pdf", filename: "carta-completa.pdf" },
    });
  });

  it("la foto lleva su pie dentro del mismo globo", async () => {
    const f = espiarFetch();
    await whatsappAdapter.sendReply(
      { channel: "whatsapp", channelUserId: "52155", parts: [FOTO], interChunkDelayMs: 0 },
      env,
    );
    expect(cuerpo(f)).toMatchObject({
      type: "image",
      image: { link: "https://x/plato.jpg", caption: "Menú de hoy" },
    });
  });

  it("un enlace sí pide vista previa; el texto normal no", async () => {
    const f = espiarFetch();
    await whatsappAdapter.sendReply(
      {
        channel: "whatsapp",
        channelUserId: "52155",
        parts: [{ kind: "text", text: "hola" }, ENLACE],
        interChunkDelayMs: 0,
      },
      env,
    );
    expect(cuerpo(f, 0).text.preview_url).toBe(false);
    expect(cuerpo(f, 1).text.preview_url).toBe(true);
  });
});

describe("Kapso — el mismo protocolo de Meta", () => {
  it("manda el documento igual que WhatsApp Cloud", async () => {
    const f = espiarFetch();
    await kapsoAdapter.sendReply(
      { channel: "kapso", channelUserId: "52155", parts: [PDF], interChunkDelayMs: 0 },
      { KAPSO_API_KEY: "K", KAPSO_PHONE_NUMBER_ID: "P" } as any,
    );
    expect(cuerpo(f)).toMatchObject({
      type: "document",
      document: { filename: "carta-completa.pdf" },
    });
  });
});

describe("Meta — Messenger e Instagram no pueden lo mismo", () => {
  it("en Messenger el pie sale antes y el adjunto después", async () => {
    const f = espiarFetch();
    await metaAdapter.sendReply(
      { channel: "messenger", channelUserId: "u1", parts: [FOTO], interChunkDelayMs: 0 },
      { META_PAGE_ACCESS_TOKEN: "T" } as any,
    );
    expect(f).toHaveBeenCalledTimes(2);
    expect(cuerpo(f, 0).message).toEqual({ text: "Menú de hoy" });
    expect(cuerpo(f, 1).message).toEqual({
      attachment: { type: "image", payload: { url: "https://x/plato.jpg", is_reusable: true } },
    });
  });

  it("en Messenger el PDF va como archivo", async () => {
    const f = espiarFetch();
    await metaAdapter.sendReply(
      { channel: "messenger", channelUserId: "u1", parts: [PDF], interChunkDelayMs: 0 },
      { META_PAGE_ACCESS_TOKEN: "T" } as any,
    );
    expect(cuerpo(f, 0).message.attachment.type).toBe("file");
  });

  it("Instagram no acepta archivos: degrada a enlace en vez de fallar callado", async () => {
    const f = espiarFetch();
    await metaAdapter.sendReply(
      { channel: "instagram", channelUserId: "u1", parts: [PDF], interChunkDelayMs: 0 },
      { INSTAGRAM_ACCESS_TOKEN: "IGAA" } as any,
    );
    // La primera llamada de IG Login resuelve el sender id; el envío es la otra.
    const envio = f.mock.calls.find((c: any) => c[1]?.method === "POST");
    const msg = JSON.parse(String(envio![1].body)).message;
    expect(msg.attachment).toBeUndefined();
    expect(msg.text).toContain("https://x/carta.pdf");
  });
});

describe("Twilio — todo adjunto es un MediaUrl", () => {
  const env = { TWILIO_ACCOUNT_SID: "S", TWILIO_AUTH_TOKEN: "A", TWILIO_WA_FROM: "+1" } as any;

  it("la foto va como media y el pie como cuerpo, sin repetir la URL", async () => {
    const f = espiarFetch();
    await twilioAdapter.sendReply(
      { channel: "twilio", channelUserId: "+52155", parts: [FOTO], interChunkDelayMs: 0 },
      env,
    );
    const body = f.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("MediaUrl0")).toBe("https://x/plato.jpg");
    expect(body.get("Body")).toBe("Menú de hoy");
  });
});

describe("ManyChat — image/file con el pie aparte", () => {
  it("el PDF sale como file, precedido por su pie", async () => {
    const f = espiarFetch();
    await manychatAdapter.sendReply(
      {
        channel: "manychat",
        channelUserId: "s1",
        parts: [{ ...PDF, caption: "Aquí va la carta" } as MessagePart],
        interChunkDelayMs: 0,
      },
      { MANYCHAT_API_KEY: "K" } as any,
    );
    expect(f).toHaveBeenCalledTimes(2);
    expect(cuerpo(f, 0).data.content.messages[0]).toEqual({ type: "text", text: "Aquí va la carta" });
    expect(cuerpo(f, 1).data.content.messages[0]).toEqual({ type: "file", url: "https://x/carta.pdf" });
  });
});

describe("Correo — el archivo viaja DENTRO del mensaje", () => {
  it("separa el cuerpo de los adjuntos y no pierde el pie", () => {
    const { texto, adjuntos } = componerCorreo([
      { kind: "text", text: "Claro, aquí va todo." },
      FOTO,
      PDF,
    ]);

    expect(adjuntos).toEqual([
      { filename: "plato.jpg", url: "https://x/plato.jpg" },
      { filename: "carta-completa.pdf", url: "https://x/carta.pdf" },
    ]);
    // El pie de la foto se queda en el cuerpo, que es donde se lee.
    expect(texto).toBe("Claro, aquí va todo.\n\nMenú de hoy");
  });

  it("la nota de voz se manda transcrita, no como .ogg adjunto", () => {
    const { texto, adjuntos } = componerCorreo([VOZ]);
    expect(adjuntos).toEqual([]);
    expect(texto).toBe("Ya vamos");
  });
});

const OPCIONES: MessagePart = {
  kind: "options",
  text: "¿Te aparto mesa?",
  options: [
    { id: "1-si-para-hoy", label: "Sí, para hoy" },
    { id: "2-manana", label: "Mañana" },
  ],
};

describe("Botones — cada canal tiene los suyos", () => {
  it("Telegram: inline_keyboard, una fila por botón", async () => {
    const f = espiarFetch();
    await telegramAdapter.sendReply(
      { channel: "telegram", channelUserId: "1", parts: [OPCIONES], interChunkDelayMs: 0 },
      { TELEGRAM_BOT_TOKEN: "T" } as any,
    );
    const envio = f.mock.calls.find((c: any) => String(c[0]).includes("/sendMessage"));
    const body = JSON.parse(String(envio![1].body));
    expect(body.text).toBe("¿Te aparto mesa?");
    expect(body.reply_markup.inline_keyboard).toEqual([
      [{ text: "Sí, para hoy", callback_data: "1-si-para-hoy" }],
      [{ text: "Mañana", callback_data: "2-manana" }],
    ]);
  });

  it("WhatsApp: interactive con botones de respuesta", async () => {
    const f = espiarFetch();
    await whatsappAdapter.sendReply(
      { channel: "whatsapp", channelUserId: "52155", parts: [OPCIONES], interChunkDelayMs: 0 },
      { WHATSAPP_PHONE_NUMBER_ID: "P", WHATSAPP_ACCESS_TOKEN: "T" } as any,
    );
    expect(cuerpo(f)).toMatchObject({
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "¿Te aparto mesa?" },
        action: {
          buttons: [
            { type: "reply", reply: { id: "1-si-para-hoy", title: "Sí, para hoy" } },
            { type: "reply", reply: { id: "2-manana", title: "Mañana" } },
          ],
        },
      },
    });
  });

  it("Messenger: quick_replies colgadas del mismo mensaje, no de otro", async () => {
    const f = espiarFetch();
    await metaAdapter.sendReply(
      { channel: "messenger", channelUserId: "u1", parts: [OPCIONES], interChunkDelayMs: 0 },
      { META_PAGE_ACCESS_TOKEN: "T" } as any,
    );
    expect(f).toHaveBeenCalledTimes(1);
    expect(cuerpo(f).message).toEqual({
      text: "¿Te aparto mesa?",
      quick_replies: [
        { content_type: "text", title: "Sí, para hoy", payload: "1-si-para-hoy" },
        { content_type: "text", title: "Mañana", payload: "2-manana" },
      ],
    });
  });

  it("Twilio no tiene botones: lista numerada, y el cliente contesta el número", async () => {
    const f = espiarFetch();
    await twilioAdapter.sendReply(
      { channel: "twilio", channelUserId: "+52155", parts: [OPCIONES], interChunkDelayMs: 0 },
      { TWILIO_ACCOUNT_SID: "S", TWILIO_AUTH_TOKEN: "A", TWILIO_WA_FROM: "+1" } as any,
    );
    const body = f.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("Body")).toBe("¿Te aparto mesa?\n1) Sí, para hoy\n2) Mañana");
    expect(body.get("MediaUrl0")).toBeNull();
  });
});
