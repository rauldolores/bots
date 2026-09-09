const DEFAULT_MAX_CHUNKS = 3;

/**
 * Canales donde una respuesta NUNCA se parte, pase lo que pase en la config.
 *
 * El correo es el caso. En chat, varios mensajes cortos se leen como una
 * persona escribiendo — es justo lo que el troceo busca. En correo se leen
 * como spam, y los filtros opinan igual: varios correos seguidos al mismo
 * destinatario castigan la reputación del dominio, así que el daño no se
 * queda en cómo se ve.
 *
 * Y no basta con volver a pegar los pedazos al final: el troceo REESCRIBE el
 * texto. Un párrafo se corta por oraciones y se le meten saltos dobles a
 * media idea; y cuando hay más párrafos que trozos, la cola se une con
 * ESPACIOS, así que el correo pierde sus párrafos. Por eso se decide aquí,
 * antes de trocear, y no en el adaptador.
 */
const SIN_TROCEO: ReadonlySet<string> = new Set(["email"]);

/**
 * Trocea según el canal: uno solo donde partir haría daño, y lo de siempre en
 * el resto. Es el único punto por el que debería pasar el troceo de una
 * respuesta.
 */
export function chunkReplyForChannel(channel: string, text: string, maxChunks?: number): string[] {
  if (SIN_TROCEO.has(channel)) {
    const entero = text.trim();
    // Vacío jamás: un canal que publica "" deja un mensaje en blanco.
    return entero ? [entero] : [];
  }
  return chunkReply(text, maxChunks);
}

export function chunkReply(text: string, maxChunks: number = DEFAULT_MAX_CHUNKS): string[] {
  const cap = Math.max(1, Math.floor(maxChunks));
  const trimmed = text.trim();

  if (cap === 1) return [trimmed];

  // Try paragraph split first (explicit breaks win over length)
  const paras = trimmed.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paras.length > 1 && paras.length <= cap) {
    return paras;
  }
  if (paras.length > cap) {
    // Keep the first cap-1 paragraphs, merge the tail into the last chunk
    const head = paras.slice(0, cap - 1);
    const tail = paras.slice(cap - 1).join(" ");
    return [...head, tail];
  }

  // Single paragraph — try sentence split
  const sentences = trimmed.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length <= 1) return [trimmed];

  // Distribute sentences into <= cap groups
  const chunks: string[] = [];
  const perChunk = Math.ceil(sentences.length / cap);
  for (let i = 0; i < sentences.length; i += perChunk) {
    chunks.push(sentences.slice(i, i + perChunk).join(" "));
  }
  return chunks.slice(0, cap);
}
