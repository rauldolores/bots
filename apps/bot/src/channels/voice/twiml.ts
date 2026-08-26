// El TwiML que le contestamos a Twilio cuando entra una llamada. <Connect><Stream>
// (no <Start><Stream>) es lo que hace el Media Stream BIDIRECCIONAL — con
// <Start> Twilio solo nos manda audio, no acepta que se lo mandemos de vuelta.

function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * `params` va como `<Parameter>` hijos de `<Stream>`, NUNCA como query string
 * en `url` — Twilio no preserva el query string al abrir el WebSocket del
 * Media Stream (confirmado en producción: la conexión real llega sin nada
 * después de `?`). Estos `<Parameter>` sí le llegan al gateway, en
 * `start.customParameters` del primer mensaje ("start") del WebSocket — ver
 * gateway.ts.
 */
export function buildConnectStreamTwiml(streamUrl: string, params?: Record<string, string>): string {
  if (!params || Object.keys(params).length === 0) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${escapeXmlAttr(streamUrl)}"/></Connect></Response>`;
  }
  const paramTags = Object.entries(params)
    .map(([name, value]) => `<Parameter name="${escapeXmlAttr(name)}" value="${escapeXmlAttr(value)}"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${escapeXmlAttr(streamUrl)}">${paramTags}</Stream></Connect></Response>`;
}
