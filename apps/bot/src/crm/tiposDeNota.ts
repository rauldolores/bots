/**
 * De qué fue la interacción, para que la nota no llegue siempre como "nota".
 *
 * En el CRM la nota de una llamada, la de un WhatsApp y la de una reunión se
 * ven igual si todas nacen con `type: "note"` — y el equipo pierde la única
 * pista de por dónde habló el cliente. Como el canal ya lo sabemos con
 * certeza (está en la conversación), no hay nada que adivinar: se traduce.
 *
 * Los valores son los que espera `crm.contact_notes.type`. Si una instalación
 * de Vinqulia no acepta alguno, el adaptador reintenta con "note" en vez de
 * perder la nota — ver aplicarCambio en connectors/crm/vinqulia.ts.
 */

/** El tipo neutro: lo que se usa cuando el canal no dice nada más específico. */
export const TIPO_NOTA_DEFAULT = "note";

/** El catálogo completo, con su nombre en español para el panel. */
export const TIPOS_DE_NOTA: ReadonlyArray<{ value: string; label: string }> = [
  { value: TIPO_NOTA_DEFAULT, label: "Nota" },
  { value: "call", label: "Llamada" },
  { value: "meeting", label: "Reunión" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Correo" },
  { value: "web-form", label: "Formulario web" },
];

/**
 * Canal de la conversación → tipo de nota.
 *
 * Solo se traduce lo que el canal DEMUESTRA. Telegram, Instagram/Messenger y
 * el widget del sitio no tienen un tipo propio en el catálogo, y forzarlos a
 * uno cercano ("correo" para un chat) sería peor que dejarlos en nota: el
 * equipo leería un dato falso con toda confianza.
 */
const POR_CANAL: Record<string, string> = {
  voice: "call",
  whatsapp: "whatsapp",
};

export function tipoDeNotaPorCanal(channel: string | null | undefined): string {
  return POR_CANAL[(channel ?? "").trim().toLowerCase()] ?? TIPO_NOTA_DEFAULT;
}

/** ¿Es uno de los tipos que conocemos? Lo que venga de una propuesta vieja o de un payload raro cae al neutro. */
export function tipoDeNotaValido(v: unknown): string {
  return TIPOS_DE_NOTA.some((t) => t.value === v) ? (v as string) : TIPO_NOTA_DEFAULT;
}
