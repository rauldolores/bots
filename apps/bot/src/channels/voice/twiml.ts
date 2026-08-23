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

export function buildConnectStreamTwiml(streamUrl: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${escapeXmlAttr(streamUrl)}"/></Connect></Response>`;
}
