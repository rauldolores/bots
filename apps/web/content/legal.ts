// Datos que comparten los tres documentos legales (/privacidad, /terminos y
// /privacidad/usuarios). Viven aquí y no repetidos en cada página para que
// cambiar el domicilio, el correo de contacto o un proveedor sea un solo
// lugar — y para que los tres digan exactamente lo mismo.
//
// Lo que NO está aquí a propósito: texto legal. Las cláusulas son de cada
// página; esto son hechos.

/** Quién responde por el tratamiento (LFPDPPP, art. 3 fr. XIV y art. 16). */
export const RESPONSABLE = {
  razonSocial: "Kontrolia S.A. de C.V.",
  nombreComercial: "Nodia Agents",
  domicilio: "Bugambilias 6, Villas Xaltipa 2, Cuautitlán, Estado de México, México",
  /** Correo único para derechos ARCO, revocación, dudas y eliminación de datos. */
  correo: "hola@kontrolia.io",
  sitio: "https://nodiagents.com",
} as const;

/** Cuándo se actualizó cada documento por última vez. Se muestra arriba. */
export const ULTIMA_ACTUALIZACION = "18 de septiembre de 2026";

/** Jurisdicción para los Términos. */
export const JURISDICCION = "los tribunales competentes de Cuautitlán Izcalli, Estado de México";

/**
 * Dónde viven los datos. La región manda en el aviso: todo fuera de México
 * es una transferencia internacional y la ley obliga a decirlo.
 */
export const INFRAESTRUCTURA = [
  { nombre: "Supabase", que: "base de datos y almacenamiento cifrado", donde: "Estados Unidos (región us-west-2, Oregón)" },
  { nombre: "Vercel", que: "servidores del panel y de los canales de chat", donde: "Estados Unidos" },
  { nombre: "Fly.io", que: "servidor de llamadas de voz", donde: "Estados Unidos (Dallas)" },
] as const;

/**
 * Terceros que reciben datos SOLO cuando el negocio conecta ese servicio.
 * Se listan todos aunque un cliente use dos: el aviso tiene que cubrir lo que
 * el producto puede hacer, no lo que un cliente en particular activó.
 */
export const PROVEEDORES = [
  {
    grupo: "Inteligencia artificial",
    nota: "El modelo lee cada mensaje para poder responderlo. El negocio elige el proveedor y usa su propia llave, así que la relación contractual con el proveedor es del negocio.",
    lista: ["OpenAI", "Anthropic", "xAI", "DeepSeek"],
  },
  {
    grupo: "Voz",
    nota: "Solo si el negocio activa llamadas telefónicas.",
    lista: ["ElevenLabs (voz y transcripción)", "Twilio (telefonía)"],
  },
  {
    grupo: "Canales de mensajería",
    nota: "El canal por el que escribes ya tiene tus datos antes de que lleguen a nosotros.",
    lista: ["Meta (WhatsApp, Instagram, Messenger)", "Telegram", "Kapso", "ManyChat"],
  },
  {
    grupo: "Correo",
    nota: "Solo si el negocio conecta su buzón.",
    lista: ["Resend", "Mailgun"],
  },
  {
    grupo: "Sistemas del negocio",
    nota: "Solo si el negocio los conecta. Ahí se registran contactos, citas y tickets a nombre del negocio.",
    lista: ["Vinqulia", "HubSpot", "Pipedrive", "Salesforce", "Zendesk", "Jira", "Google Calendar", "Cal.com", "servidores MCP propios del negocio"],
  },
  {
    grupo: "Pagos y cuentas",
    nota: "Solo para los clientes de Nodia Agents (los negocios), nunca para las personas que conversan con un agente.",
    lista: ["Stripe (cobro de suscripciones)", "KontrolIA Auth (inicio de sesión)"],
  },
] as const;

/** Cuánto tiempo se guarda cada cosa. Lo que la ley llama "plazo de conservación". */
export const CONSERVACION = [
  { que: "Conversaciones y transcripciones de chat", plazo: "Mientras el negocio mantenga su cuenta, y hasta 90 días después de que la cancele." },
  { que: "Grabaciones y transcripciones de llamadas", plazo: "Apagadas por defecto. Si el negocio las activa, el mismo plazo que las conversaciones." },
  { que: "Leads, citas y tickets", plazo: "Mientras el negocio mantenga su cuenta. Si además los registró en su CRM, ahí aplican las políticas del negocio." },
  { que: "Datos de la cuenta del negocio y facturación", plazo: "Mientras dure la relación comercial y el plazo que exija la ley fiscal (cinco años)." },
  { que: "Registros técnicos (bitácoras)", plazo: "90 días." },
] as const;
