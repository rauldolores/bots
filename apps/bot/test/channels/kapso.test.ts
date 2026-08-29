// WhatsApp vía Kapso — firma del webhook y parseo del payload v2.
//
// La firma se calcula aquí con `node:crypto` A PROPÓSITO: es un camino
// INDEPENDIENTE del de producción (que usa crypto.subtle, portable a
// Cloudflare/Vercel). Si los dos coinciden, la implementación es correcta de
// verdad; reusar la misma función para generar y verificar no probaría nada.
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyKapsoSignature, parseKapsoInbound } from "../../src/channels/kapso";

const SECRET = "wh_sec_3kfj9dmfkg8s2";
const firmar = (body: string, secret = SECRET) => createHmac("sha256", secret).update(body).digest("hex");

describe("verifyKapsoSignature", () => {
  const body = JSON.stringify({ message: { id: "wamid.1" } });

  it("acepta una firma correcta", async () => {
    expect(await verifyKapsoSignature(body, firmar(body), SECRET)).toBe(true);
  });

  it("tolera el prefijo sha256= (su propio SDK lo quita, aunque la doc no lo muestre)", async () => {
    expect(await verifyKapsoSignature(body, `sha256=${firmar(body)}`, SECRET)).toBe(true);
  });

  it("no le importa que venga en mayúsculas", async () => {
    expect(await verifyKapsoSignature(body, firmar(body).toUpperCase(), SECRET)).toBe(true);
  });

  it("rechaza si el cuerpo cambió aunque sea un carácter", async () => {
    expect(await verifyKapsoSignature(body + " ", firmar(body), SECRET)).toBe(false);
  });

  it("rechaza una firma hecha con otro secreto", async () => {
    expect(await verifyKapsoSignature(body, firmar(body, "otro-secreto"), SECRET)).toBe(false);
  });

  // Fail-closed: sin secreto o sin header NUNCA se acepta — es lo que evita
  // que un canal a medio configurar deje el webhook abierto a cualquiera.
  it("rechaza sin header de firma", async () => {
    expect(await verifyKapsoSignature(body, null, SECRET)).toBe(false);
    expect(await verifyKapsoSignature(body, "", SECRET)).toBe(false);
    expect(await verifyKapsoSignature(body, "sha256=", SECRET)).toBe(false);
  });

  it("rechaza sin secreto guardado", async () => {
    expect(await verifyKapsoSignature(body, firmar(body), "")).toBe(false);
  });
});

// Payload real de la doc (docs.kapso.ai/docs/platform/webhooks/message-events),
// recortado a los campos que consumimos.
function evento(over: Record<string, unknown> = {}) {
  return {
    message: {
      id: "wamid.123",
      timestamp: "1730092800",
      type: "text",
      from: "16315551181",
      text: { body: "Hola, ¿tienen disponibilidad?" },
      kapso: { direction: "inbound", has_media: false, content: "Hola, ¿tienen disponibilidad?" },
    },
    conversation: {
      id: "conv_123",
      contact_name: "Zuriel Alcántara",
      phone_number: "16315551181",
      business_scoped_user_id: "US.13491208655302741918",
    },
    phone_number_id: "123456789012345",
    ...over,
  };
}

describe("parseKapsoInbound", () => {
  it("saca texto, teléfono y nombre de un mensaje normal", () => {
    const [m] = parseKapsoInbound(JSON.stringify(evento()));
    expect(m.channel).toBe("kapso");
    expect(m.channelUserId).toBe("16315551181");
    expect(m.displayName).toBe("Zuriel Alcántara");
    expect(m.text).toBe("Hola, ¿tienen disponibilidad?");
    expect(m.isOwnerMessage).toBe(false);
  });

  // La doc de Kapso avisa de no dar por hecho `from`: WhatsApp ya permite
  // identidades sin número (BSUID). Si el bot no cae al identificador que sí
  // vino, esos clientes quedan sin respuesta.
  it("cae al BSUID cuando el mensaje no trae número", () => {
    const [m] = parseKapsoInbound(
      JSON.stringify(
        evento({
          message: { id: "wamid.9", type: "text", text: { body: "hola" }, from_user_id: "US.134912" },
          conversation: { contact_name: "Sin número" },
        }),
      ),
    );
    expect(m.channelUserId).toBe("US.134912");
  });

  // Kapso transcribe los audios él mismo — usar SU texto evita una segunda
  // transcripción nuestra, y encima sus URLs de media caducan a los ~4 min
  // (el turno se responde después del buffer, así que podría llegar muerta).
  it("un audio transcrito llega como TEXTO, sin audioUrl", () => {
    const [m] = parseKapsoInbound(
      JSON.stringify(
        evento({
          message: {
            id: "wamid.2",
            type: "audio",
            from: "16315551181",
            kapso: {
              has_media: true,
              transcript: { text: "Quiero agendar una cita" },
              media_url: "https://api.kapso.ai/media/abc",
              media_data: { content_type: "audio/ogg" },
            },
          },
        }),
      ),
    );
    expect(m.text).toBe("Quiero agendar una cita");
    expect(m.audioUrl).toBeUndefined();
  });

  it("un audio SIN transcripción sí pasa la URL para que lo transcribamos nosotros", () => {
    const [m] = parseKapsoInbound(
      JSON.stringify(
        evento({
          message: {
            id: "wamid.3",
            type: "audio",
            from: "16315551181",
            kapso: { has_media: true, media_url: "https://api.kapso.ai/media/xyz", media_data: { content_type: "audio/ogg" } },
          },
        }),
      ),
    );
    expect(m.audioUrl).toBe("https://api.kapso.ai/media/xyz");
    expect(m.text).toBeUndefined();
  });

  it("una imagen pasa su URL y conserva el caption como texto", () => {
    const [m] = parseKapsoInbound(
      JSON.stringify(
        evento({
          message: {
            id: "wamid.4",
            type: "image",
            from: "16315551181",
            text: { body: "¿Tienen este modelo?" },
            kapso: { has_media: true, media_url: "https://api.kapso.ai/media/img", media_data: { content_type: "image/jpeg" } },
          },
        }),
      ),
    );
    expect(m.imageUrl).toBe("https://api.kapso.ai/media/img");
    expect(m.text).toBe("¿Tienen este modelo?");
  });

  // Nosotros registramos el webhook SIN buffering, pero el dueño puede
  // prenderlo desde su panel — ahí el body cambia de forma por completo.
  it("entiende el envelope de batch (buffering activado a mano)", () => {
    const ms = parseKapsoInbound(
      JSON.stringify({
        type: "whatsapp.message.received",
        batch: true,
        data: [evento(), evento({ message: { id: "wamid.5", type: "text", from: "521999", text: { body: "segundo" } } })],
      }),
    );
    expect(ms).toHaveLength(2);
    expect(ms[1].text).toBe("segundo");
  });

  // Nada de esto puede lanzar: el webhook responde 200 igual, porque con
  // suficientes fallos Kapso AUTO-PAUSA el webhook y hay que reactivarlo a mano.
  it("devuelve vacío (sin lanzar) ante algo que no es un mensaje", () => {
    expect(parseKapsoInbound("no soy json")).toEqual([]);
    expect(parseKapsoInbound(JSON.stringify({ conversation: { id: "c1" } }))).toEqual([]);
    expect(parseKapsoInbound(JSON.stringify({ message: { id: "x", type: "text" } }))).toEqual([]); // sin remitente
  });
});
