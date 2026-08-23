// Logs estructurados del canal Voice. Regla dura: NUNCA se registra audio
// (media.payload) ni secretos (Auth Token, tokens de stream, firmas) — solo
// metadatos (ids enmascarados, tamaños, contadores).

/** Últimos 4 caracteres de un id — alcanza para correlacionar logs sin exponer el id completo (mismo criterio que channels/meta.ts). */
export function maskId(id: string | null | undefined): string {
  if (!id) return "—";
  return id.length <= 4 ? `…${id}` : `…${id.slice(-4)}`;
}

export function logVoiceEvent(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ scope: "voice", event, ts: Date.now(), ...fields }));
}
