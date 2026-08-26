// F8 fase B: llevar cualquier forma de contacto a UNA sola representación.
//
// El mismo humano existe hoy en el sistema con formatos incompatibles y nada
// los reconciliaba:
//
//   twilio (WhatsApp)   channel_user_id = "+5215512345678"  (E.164 con +)
//   whatsapp Cloud API  channel_user_id = "5215512345678"   (sin +, con el 1)
//   voice               channel_user_id = "+5215512345678"
//   leads.contact       lo que el LLM haya escrito: "55 1234 5678"
//
// Sin un formato canónico no se puede saber si esas cuatro filas son la misma
// persona, y por lo tanto no se le puede dar seguimiento.
//
// Se usa libphonenumber-js (el port del de Google) y no una regex propia por
// un caso concreto: México metió un "1" después del +52 para móviles y lo
// quitó en 2019, pero WhatsApp lo sigue mandando. Escribir eso a mano es justo
// donde se rompen estas cosas, y México es el mercado principal de este repo.
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export type ContactKind = "phone" | "email" | "channel";

/**
 * De la zona horaria del negocio al país, porque `bots.config.country` es
 * texto LIBRE que el dueño escribe a mano ("Ej. México") y no sirve para
 * esto. `timezone` en cambio sale de una lista cerrada (datetime.ts), así que
 * es la única pista confiable que ya tenemos.
 */
const REGION_BY_TIMEZONE: Record<string, CountryCode> = {
  "America/Mexico_City": "MX",
  "America/Cancun": "MX",
  "America/Hermosillo": "MX",
  "America/Tijuana": "MX",
  "America/Bogota": "CO",
  "America/Santiago": "CL",
  "America/Argentina/Buenos_Aires": "AR",
  "America/New_York": "US",
  "America/Los_Angeles": "US",
  "Europe/Madrid": "ES",
};

/** País por default para interpretar un número escrito sin lada internacional. */
export function regionForTimezone(timezone: string | null | undefined): CountryCode {
  return REGION_BY_TIMEZONE[(timezone ?? "").trim()] ?? "MX";
}

/**
 * Quita el prefijo "whatsapp:" que Twilio pone en From/To.
 *
 * Vivía duplicado a mano en channels/twilio.ts y admin/views/conexiones.ts, y
 * se volvía a pegar en tres lugares más. Centralizarlo evita que una tercera
 * copia se desincronice.
 */
export function stripWhatsappPrefix(value: string): string {
  return value.replace(/^whatsapp:/i, "").trim();
}

/**
 * El "1" móvil legacy de México.
 *
 * Hasta 2019 los celulares se marcaban +52 1 XX XXXX XXXX. Ya no, y
 * libphonenumber lo trata como INVÁLIDO (verificado: `+5215512345678` parsea
 * pero `isValid()` es false, incluso con la metadata completa). El problema es
 * que WhatsApp sigue mandando esa forma hasta hoy, así que si no lo quitamos
 * antes de validar, TODO contacto que llegue por WhatsApp se descarta.
 */
function stripLegacyMxMobile(digits: string): string {
  return /^521\d{10}$/.test(digits) ? `52${digits.slice(3)}` : digits;
}

/** A E.164 ("+525512345678"), o null si no es un teléfono válido. */
export function normalizePhone(
  raw: string | null | undefined,
  region: CountryCode = "MX",
): string | null {
  const value = stripWhatsappPrefix(String(raw ?? ""));
  if (!value) return null;
  try {
    const digits = value.replace(/\D/g, "");
    const traeMas = value.startsWith("+");

    // Con lada de país (con "+" o simplemente más largo que un número local),
    // se interpreta como internacional. WhatsApp Cloud API manda justo esto:
    // "5215512345678", sin "+".
    if (digits && (traeMas || digits.length > 10)) {
      const intl = parsePhoneNumberFromString(`+${stripLegacyMxMobile(digits)}`);
      if (intl?.isValid()) return intl.number;
    }

    // Si no, es un número local del país del negocio ("55 1234 5678").
    const local = parsePhoneNumberFromString(value, region);
    return local?.isValid() ? local.number : null;
  } catch {
    return null;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Minúsculas y sin espacios, o null si no parece un correo. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").trim().toLowerCase();
  return EMAIL_RE.test(value) ? value : null;
}

export interface ClassifiedContact {
  kind: ContactKind;
  addressRaw: string;
  addressNorm: string;
}

/**
 * Qué es este dato de contacto. `leads.contact` es una sola columna de texto
 * libre que el LLM llena con "teléfono o email", así que hay que adivinarlo —
 * pero adivinarlo UNA vez, aquí, y guardar el resultado tipado.
 *
 * Devuelve null cuando no es ni un teléfono válido ni un correo: mejor no
 * guardar nada que guardar un contacto al que no se le puede escribir.
 */
export function classifyContact(
  raw: string | null | undefined,
  region: CountryCode = "MX",
): ClassifiedContact | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;

  const email = normalizeEmail(value);
  if (email) return { kind: "email", addressRaw: value, addressNorm: email };

  const phone = normalizePhone(value, region);
  if (phone) return { kind: "phone", addressRaw: value, addressNorm: phone };

  return null;
}

/**
 * Las formas en que ESE mismo teléfono pudo haberse guardado como
 * `conversations.channel_user_id`, para poder cruzar un lead contra las
 * conversaciones que ya existen.
 *
 * Cubre las tres variantes reales del sistema: con "+", sin "+", y la de
 * WhatsApp para México (que reinserta el "1" después del 52).
 */
export function phoneVariants(e164: string): string[] {
  const sinMas = e164.replace(/^\+/, "");
  const variantes = new Set<string>([e164, sinMas]);

  // México: WhatsApp manda 521XXXXXXXXXX aunque el número marcable sea
  // 52XXXXXXXXXX. Sin esta variante, un lead con teléfono nunca cruzaría con
  // su propia conversación de WhatsApp.
  if (/^52\d{10}$/.test(sinMas)) {
    const conUno = `521${sinMas.slice(2)}`;
    variantes.add(conUno);
    variantes.add(`+${conUno}`);
  }
  if (/^521\d{10}$/.test(sinMas)) {
    const sinUno = `52${sinMas.slice(3)}`;
    variantes.add(sinUno);
    variantes.add(`+${sinUno}`);
  }

  return [...variantes];
}

/**
 * Con qué clave(s) se registra y se consulta la baja de quien escribe por un
 * canal.
 *
 * Si su identificador ES un teléfono (twilio, whatsapp, voz) se usan todas las
 * variantes de ese número: así la baja vale aunque mañana entre por otro canal
 * telefónico con el número escrito distinto.
 *
 * Si es un id opaco (telegram chat_id, PSID de Meta, sesión del widget) se le
 * antepone el canal. Sin eso, dos personas distintas con el mismo número de id
 * en canales distintos compartirían la baja.
 */
export function optOutKeysFor(
  channel: string,
  channelUserId: string,
  region: CountryCode = "MX",
): string[] {
  const telefono = normalizePhone(channelUserId, region);
  return telefono ? phoneVariants(telefono) : [`${channel}:${channelUserId}`];
}
