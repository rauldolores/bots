/**
 * Por dónde escribe la persona y qué dato de contacto trae ESE canal.
 *
 * Bug real (bot de AduaniaX, 2026-10-23): un cliente escribió por correo y el
 * bot le contestó "¿me confirmas tu correo electrónico?". El modelo solo
 * sabía quién escribía si ya existía un lead; el correo desde el que llegó el
 * mensaje —o el número desde el que escribe por WhatsApp, o la página del
 * sitio donde abrió el chat— nunca se le decía, y lo pedía o lo inventaba.
 *
 * Solo se afirma lo que el canal GARANTIZA: el remitente de un correo, el
 * número de WhatsApp o de quien llama. Telegram, Messenger, Instagram y el
 * widget no traen teléfono ni correo, y se le dice así para que, si de verdad
 * hace falta para registrar algo, lo pida en vez de suponerlo.
 */

const NOMBRE_DEL_CANAL: Record<string, string> = {
  email: "correo electrónico",
  whatsapp: "WhatsApp",
  twilio: "WhatsApp",
  kapso: "WhatsApp",
  voice: "una llamada telefónica",
  telegram: "Telegram",
  messenger: "Facebook Messenger",
  instagram: "Instagram",
  manychat: "Messenger/Instagram",
  widget: "el chat del sitio web",
};

const ES_CORREO = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** "+5215512345678" o "5215512345678" → "+5215512345678"; null si no parece un teléfono (BSUID, id de sesión…). */
function comoTelefono(id: string): string | null {
  const limpio = id.replace(/^(whatsapp|tel):/i, "").replace(/[\s()-]/g, "");
  return /^\+?\d{8,15}$/.test(limpio) ? (limpio.startsWith("+") ? limpio : `+${limpio}`) : null;
}

export interface DatosDelCanal {
  channel: string;
  channelUserId: string;
  /** Solo widget: la página (origen + ruta, sin query) desde la que escribió. */
  paginaDelWidget?: string | null;
}

export function bloqueDeCanal(d: DatosDelCanal): string | null {
  const nombre = NOMBRE_DEL_CANAL[d.channel];
  if (!nombre) return null;
  const id = d.channelUserId.trim();
  const lineas: string[] = [];

  if (d.channel === "email" && ES_CORREO.test(id)) {
    lineas.push(
      `Te escribe por correo electrónico desde ${id}. Ese ES su correo: no se lo pidas. Úsalo para buscarlo o registrar su caso, y para presentarlo si lo canalizas.`,
    );
  } else if (d.channel === "voice") {
    const tel = comoTelefono(id);
    lineas.push(
      tel
        ? `Te llama por teléfono desde el número ${tel}. Ese ES su número: no se lo pidas (puedes confirmarlo si va a recibir un mensaje ahí).`
        : "Te llama por teléfono con el número oculto: si hace falta para registrar algo, pídeselo.",
    );
  } else if (nombre === "WhatsApp") {
    const tel = comoTelefono(id);
    lineas.push(
      tel
        ? `Te escribe por WhatsApp desde el número ${tel}. Ese ES su teléfono: no se lo pidas. Úsalo para buscarlo o registrar su caso.`
        : "Te escribe por WhatsApp, pero su número no viene en el mensaje: si hace falta para registrar algo, pídeselo.",
    );
  } else {
    lineas.push(
      `Te escribe por ${nombre}. Este canal no te da su teléfono ni su correo: si hacen falta para registrar algo o darle seguimiento, pídeselos.`,
    );
  }

  if (d.channel === "widget" && d.paginaDelWidget) {
    lineas.push(`Abrió el chat en la página ${d.paginaDelWidget} — úsala para entender de qué viene a preguntar.`);
  }

  return `<canal>\n${lineas.join("\n")}\n</canal>`;
}

/**
 * La página del widget tal como se guarda: solo origen + ruta. La query y el
 * hash se tiran a propósito — ahí viajan tokens de sesión, enlaces de
 * restablecer contraseña y similares, y esto termina en el prompt y en la base.
 */
export function paginaSegura(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
    return `${u.origin}${u.pathname}`.slice(0, 300);
  } catch {
    return undefined;
  }
}
