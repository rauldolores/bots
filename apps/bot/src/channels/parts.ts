// Los bloques de una respuesta — el vocabulario ÚNICO con el que el bot dice
// qué quiere mandar, sin saber por dónde va a salir.
//
// Hasta aquí una respuesta era `string[]`: texto y nada más. Un bloque nombra
// la intención ("esto es un documento que se llama carta.pdf"), y es el
// adaptador del canal quien decide cómo se entrega: Telegram tiene
// sendDocument, el SMS no tiene nada y manda el enlace.
//
// La regla de oro, y la razón de que `partsAsText` viva aquí y no en cada
// adaptador: **ningún canal pierde información**. Si no sabe hacer el bloque,
// lo degrada a texto con su enlace; nunca lo tira. Por eso agregar un bloque
// nuevo no obliga a tocar los ocho adaptadores: los que no lo entiendan caen
// solos en la degradación.
//
// Hoy NINGÚN canal entrega nada de forma nativa — todos degradan. Los tipos
// nativos (sendPhoto, type:"document", inline_keyboard…) llegan después,
// adaptador por adaptador, sin volver a mover esta tubería.

/** Un bloque de una respuesta. `text` es el único que el bot produce hoy. */
export type MessagePart =
  | { kind: "text"; text: string }
  /** Una foto, con su pie opcional. El pie va DENTRO del mensaje, no aparte. */
  | { kind: "image"; url: string; caption?: string }
  /** Un archivo con nombre real: es lo que distingue un PDF de un enlace feo. */
  | { kind: "document"; url: string; filename: string; caption?: string }
  /** Nota de voz. `transcript` es lo que se manda donde no hay audio. */
  | { kind: "audio"; url: string; transcript?: string }
  /** Enlace con tarjeta: título y descripción los pone quien lo manda, no el canal. */
  | { kind: "link"; url: string; title: string; description?: string }
  /** Botones de respuesta rápida. `id` es lo que vuelve al bot; `label`, lo que se lee. */
  | { kind: "options"; text: string; options: { id: string; label: string }[] };

/** Un bloque de texto. Atajo para el caso de siempre. */
export function textPart(text: string): MessagePart {
  return { kind: "text", text };
}

/** Varios bloques de texto, en orden (lo que devuelve el troceo). */
export function textParts(textos: string[]): MessagePart[] {
  return textos.map(textPart);
}

/**
 * La degradación: un bloque visto por un canal que solo sabe mandar texto.
 *
 * Nunca devuelve el URL pelón cuando hay algo que lo explique — un enlace sin
 * contexto es justo lo que hace que un bot se lea como un bot.
 */
export function partToText(part: MessagePart): string {
  switch (part.kind) {
    case "text":
      return part.text;
    case "image":
      return part.caption ? `${part.caption}\n${part.url}` : part.url;
    case "document":
      return [part.caption, part.filename, part.url].filter(Boolean).join("\n");
    case "audio":
      // La transcripción gana: leerla es mejor que recibir un enlace a un .ogg.
      return part.transcript ?? part.url;
    case "link":
      return `${part.title}\n${part.url}`;
    case "options":
      // Sin botones, el cliente contesta con el número. Se numera desde 1
      // porque es lo que la gente escribe, no el índice del arreglo.
      return [part.text, ...part.options.map((o, i) => `${i + 1}) ${o.label}`)].join("\n");
  }
}

/**
 * Los bloques que de verdad se van a mandar, ya sin los vacíos.
 *
 * Es el primer paso de CUALQUIER adaptador, sepa entregar tipos nativos o no:
 * un canal que publica "" deja un mensaje en blanco en el chat del cliente.
 */
export function partesEnviables(parts: MessagePart[]): MessagePart[] {
  return parts.filter((p) => p.kind !== "text" || p.text.trim().length > 0);
}

/**
 * Los textos que un canal sin capacidades debe mandar, uno por mensaje.
 *
 * Los vacíos se caen aquí y no en el adaptador, por lo mismo de arriba.
 */
export function partsAsText(parts: MessagePart[]): string[] {
  return parts.map(partToText).map((t) => t.trim()).filter(Boolean);
}
