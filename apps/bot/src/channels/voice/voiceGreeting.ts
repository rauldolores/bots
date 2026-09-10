// El saludo con el que el bot contesta el teléfono — YA NO es algo que el
// modelo improvise (ver realtimeBridge.ts: antes se le pedía "saluda tú
// primero, breve y natural" y el resultado era inconsistente — a veces
// narraba sus propias instrucciones, a veces sonaba a lectura de documento).
// Ahora es texto FIJO, resuelto en código antes de hablarle al modelo; al
// modelo solo se le pide que lo diga tal cual.
export const DEFAULT_VOICE_GREETING_TEMPLATE = "Hola, gracias por llamar a {{negocio}}. ¿En qué podemos ayudarte{{nombre}}?";

/**
 * Arma el saludo final, ya con los placeholders resueltos.
 *
 * {{nombre}} — SOLO se dice si ya se conoce a quien llama (ver
 * <cliente_conocido> en agent/context.ts): se reemplaza por ", <Nombre>"
 * (la coma la pone esta función, no el dueño) para que "...ayudarte{{nombre}}?"
 * quede como "...ayudarte, Raúl?" cuando se conoce, o "...ayudarte?" limpio
 * cuando no — por eso el placeholder va SIN espacio antes, pegado a la
 * palabra anterior.
 */
export function resolveVoiceGreeting(template: string | undefined, businessName: string, callerName?: string): string {
  const base = (template ?? "").trim() || DEFAULT_VOICE_GREETING_TEMPLATE;
  return base
    .replaceAll("{{negocio}}", businessName)
    .replaceAll("{{nombre}}", callerName ? `, ${callerName}` : "");
}

/**
 * Lo que dice el agente cuando RETOMA la llamada porque transfirió y el
 * humano no contestó (ocupado, timbre agotado, fallo del marcado).
 *
 * Existe porque sin esto el puente arrancaba igual que una llamada nueva y
 * el cliente oía "te comunico…", veinte segundos de timbre, y luego "Hola,
 * gracias por llamar a X, ¿en qué te ayudo?" — como si nada. No se perdía
 * nada, pero sonaba a que el bot no se acordaba de lo que acababa de hacer.
 */
export const DEFAULT_TRANSFER_FALLBACK_GREETING =
  "Disculpa{{nombre}}, en este momento no me contestan. ¿Te tomo el recado para que te devuelvan la llamada, o te ayudo yo con algo más?";

/** Mismos placeholders que el saludo normal; solo cambia el texto por defecto. */
export function resolveTransferFallbackGreeting(template: string | undefined, businessName: string, callerName?: string): string {
  return resolveVoiceGreeting((template ?? "").trim() || DEFAULT_TRANSFER_FALLBACK_GREETING, businessName, callerName);
}
