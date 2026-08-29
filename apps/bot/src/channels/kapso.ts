// WhatsApp vía Kapso (kapso.ai) — conectado desde /admin/conexiones.
//
// Kapso es un PROXY sobre la Cloud API de Meta: el cuerpo para enviar es el
// mismo de Meta, solo cambian la URL base y la autenticación (X-API-Key en
// vez del token de Meta). Ver https://docs.kapso.ai/api/introduction.
//
// Por qué existe además de "twilio" (que también es WhatsApp): son dos
// caminos distintos al mismo canal y el dueño elige el suyo. La diferencia
// grande para el usuario es el alta — con Kapso el webhook se registra SOLO
// (su Platform API lo permite), así que solo pega dos datos y no tiene que
// copiar URLs a ningún panel ajeno.
import type { ChannelAdapter, IncomingMessage, OutgoingReply } from "./shared";
import type { Env } from "../env";

const WHATSAPP_API = "https://api.kapso.ai/meta/whatsapp/v24.0";
const PLATFORM_API = "https://api.kapso.ai/platform/v1";

// ── Firma del webhook ──────────────────────────────────────────────────────

/** Mismo estilo que resend.ts/meta.ts — HMAC vía crypto.subtle, portable Node/Cloudflare/Vercel. */
async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifica el header `X-Webhook-Signature`: HMAC-SHA256 en hex sobre el body
 * CRUDO, con el `secret_key` que nosotros mismos generamos al registrar el
 * webhook. Fail-closed: sin secreto o sin header, siempre false.
 *
 * Ojo con el body: tiene que ser el texto TAL CUAL llegó. Volver a serializar
 * el objeto ya parseado (`JSON.stringify(body)`) cambia el orden/espaciado y
 * la firma deja de coincidir — los ejemplos de la doc de Kapso cometen ese
 * error, pero su propio SDK (gokapso/chat-sdk-adapter, src/kapso-webhook.ts)
 * firma el crudo. Por eso app.ts lee `c.req.text()` y no `c.req.json()`.
 *
 * El prefijo "sha256=" se tolera porque su SDK lo quita defensivamente,
 * aunque la doc muestre el header sin él.
 *
 * NO hay ventana de replay: Kapso no firma ningún timestamp (a diferencia de
 * Svix en Resend). La única defensa contra reenvíos es la deduplicación por
 * `X-Idempotency-Key` — y las entregas son at-least-once por diseño.
 */
export async function verifyKapsoSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!secret || !signatureHeader) return false;
  const recibida = signatureHeader.replace(/^sha256=/, "").trim().toLowerCase();
  if (!recibida) return false;
  const esperada = await hmacSha256Hex(secret, rawBody);
  return timingSafeEqual(recibida, esperada);
}

// ── Entrada ────────────────────────────────────────────────────────────────

/** Lo que nos interesa del payload v2 de Kapso — el resto de campos se ignoran. */
interface KapsoMessage {
  id?: string;
  type?: string;
  from?: string;
  from_user_id?: string;
  text?: { body?: string };
  kapso?: {
    content?: string;
    media_url?: string;
    media_data?: { content_type?: string };
    /** Kapso transcribe los audios por su cuenta — ver parseKapsoInbound. */
    transcript?: { text?: string };
  };
}

interface KapsoPayload {
  message?: KapsoMessage;
  conversation?: {
    contact_name?: string;
    phone_number?: string;
    business_scoped_user_id?: string;
  };
  /** Envelope de buffering: `data` trae varios eventos en vez de uno. */
  batch?: boolean;
  data?: unknown[];
}

function unMensaje(p: KapsoPayload): IncomingMessage | null {
  const m = p.message;
  if (!m) return null;

  // WhatsApp ya permite identidades SIN número (BSUID), así que `from` puede
  // no venir — la doc de Kapso avisa explícitamente de no darlo por hecho.
  // Se cae al identificador que sí exista; sin ninguno, no hay a quién
  // responderle y el evento se descarta.
  const channelUserId =
    m.from?.trim() ||
    p.conversation?.phone_number?.trim() ||
    m.from_user_id?.trim() ||
    p.conversation?.business_scoped_user_id?.trim() ||
    "";
  if (!channelUserId) return null;

  const mime = m.kapso?.media_data?.content_type ?? "";
  const mediaUrl = m.kapso?.media_url?.trim() || undefined;

  // Audio: Kapso ya lo transcribió, así que se usa SU texto en vez de mandar
  // el audio por nuestro propio STT — es más rápido y una llamada menos. Y
  // conviene por otro motivo: las URLs de media de Kapso caducan a los ~4
  // minutos, y el turno no se responde al instante (hay buffer de segundos),
  // así que para cuando fuéramos a bajarla podría estar muerta.
  const transcripcion = m.kapso?.transcript?.text?.trim();
  const esAudio = m.type === "audio" || mime.startsWith("audio/");
  const esImagen = m.type === "image" || mime.startsWith("image/");

  const texto = m.text?.body?.trim() || (esAudio ? transcripcion : undefined) || undefined;

  return {
    channel: "kapso",
    channelUserId,
    displayName: p.conversation?.contact_name?.trim() || undefined,
    text: texto,
    // Solo se pasa audioUrl si NO hubo transcripción — si la hay, ya viaja
    // como texto y bajar el audio sería trabajo repetido.
    audioUrl: esAudio && !transcripcion ? mediaUrl : undefined,
    imageUrl: esImagen ? mediaUrl : undefined,
    isOwnerMessage: false, // el webhook solo entrega mensajes ENTRANTES del cliente
    receivedAt: Date.now(),
    rawPayload: p,
  };
}

/**
 * Convierte el body crudo del webhook en mensajes. Devuelve una LISTA porque
 * Kapso puede agrupar varios eventos en una sola entrega si el dueño activa
 * el "buffering" desde su panel (envelope `{batch:true, data:[...]}`) —
 * nosotros registramos el webhook sin buffering, pero si alguien lo prende a
 * mano el canal no se rompe.
 *
 * Vacío = no había nada que atender (otro tipo de evento, un mensaje sin
 * remitente, JSON inválido). Quien llama debe responder 200 igual: un error
 * haría que Kapso reintente, y con suficientes fallos AUTO-PAUSA el webhook
 * (≥20 entregas, ≥10 fallidas y ≥85% de fallo en 15 min) — recuperarse de eso
 * exige que el dueño lo reactive a mano en su panel.
 */
export function parseKapsoInbound(rawBody: string): IncomingMessage[] {
  let payload: KapsoPayload;
  try {
    payload = JSON.parse(rawBody) as KapsoPayload;
  } catch {
    return [];
  }

  if (payload?.batch && Array.isArray(payload.data)) {
    return payload.data
      .map((e) => unMensaje((e ?? {}) as KapsoPayload))
      .filter((m): m is IncomingMessage => m !== null);
  }

  const uno = unMensaje(payload ?? {});
  return uno ? [uno] : [];
}

// ── Salida ─────────────────────────────────────────────────────────────────

/**
 * Un BSUID (identidad sin número, ej. "US.1349…") no va en `to` sino en
 * `recipient` — es la forma que documenta Kapso para responderle a alguien
 * cuyo número no conocemos.
 */
function destinatario(channelUserId: string): Record<string, unknown> {
  return channelUserId.startsWith("US.")
    ? { recipient: channelUserId, recipient_type: "individual" }
    : { to: channelUserId };
}

export const kapsoAdapter: ChannelAdapter = {
  async parseIncoming(): Promise<never> {
    // Igual que "email": la firma se verifica contra el body CRUDO y con un
    // secreto que sale de bot_channels, cosas que este contrato genérico no
    // recibe. app.ts llama a verifyKapsoSignature()/parseKapsoInbound()
    // directo. Existe solo para cumplir ChannelAdapter.
    throw new Error("kapso: parseIncoming no aplica — app.ts usa parseKapsoInbound() tras verificar la firma.");
  },

  async sendReply(reply: OutgoingReply, env: Env): Promise<void> {
    const apiKey = env.KAPSO_API_KEY;
    const phoneNumberId = env.KAPSO_PHONE_NUMBER_ID;
    if (!apiKey || !phoneNumberId) throw new Error("Kapso: faltan credenciales (API key / phone number id)");

    for (let i = 0; i < reply.chunks.length; i++) {
      const delay = i === 0 ? 0 : reply.interChunkDelayMs ?? 1000;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      const res = await fetch(`${WHATSAPP_API}/${encodeURIComponent(phoneNumberId)}/messages`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          ...destinatario(reply.channelUserId),
          type: "text",
          text: { body: reply.chunks[i] },
        }),
      });
      if (!res.ok) {
        // Se lanza en vez de tragárselo: el error más común aquí es la ventana
        // de 24h de Meta cerrada (código 131047), y quien llama necesita
        // enterarse en vez de creer que el cliente recibió la respuesta.
        throw new Error(`Kapso respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
    }
  },
};

// ── Alta automática del webhook ────────────────────────────────────────────

/**
 * Registra nuestro webhook en Kapso por API, para que el dueño NO tenga que
 * copiar y pegar una URL en otro panel (mismo trato que Telegram, que es el
 * canal más fácil de conectar del panel).
 *
 * Se suscribe SOLO a `whatsapp.message.received`: los otros nueve eventos no
 * los atendemos y cada entrega fallida cuenta para la auto-pausa de Kapso.
 *
 * Nunca lanza — devuelve el motivo. Si esto falla, el canal ya quedó guardado
 * y el dueño puede pegar la URL a mano desde la tarjeta; convertirlo en un
 * error dejaría la conexión a medias por algo que tiene arreglo manual.
 */
export async function registerKapsoWebhook(
  apiKey: string,
  phoneNumberId: string,
  url: string,
  secretKey: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(
      `${PLATFORM_API}/whatsapp/phone_numbers/${encodeURIComponent(phoneNumberId)}/webhooks`,
      {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          whatsapp_webhook: {
            kind: "kapso",
            url,
            events: ["whatsapp.message.received"],
            secret_key: secretKey,
            active: true,
          },
        }),
      },
    );
    if (!res.ok) return { ok: false, error: `Kapso respondió ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}
