// Catálogo de conectores salientes por categoría — mismo espíritu que
// CHANNEL_META en conexiones.ts (pasos guiados + campos del formulario), pero
// para plataformas que el bot LLAMA (CRM, tickets) en vez de canales que le
// hablan a él. `comingSoon: true` = aparece en la pestaña pero sin botón de
// conectar todavía (honesto sobre lo que ya funciona vs. lo que falta).
import type { CrmConnector, TicketConnector, CalendarConnector } from "./types";
import { hubspotConnector } from "./crm/hubspot";
import { pipedriveConnector } from "./crm/pipedrive";
import { vinquliaConnector } from "./crm/vinqulia";
import { vinquliaTicketConnector } from "./tickets/vinqulia";
import { zendeskConnector } from "./tickets/zendesk";
import { jiraConnector } from "./tickets/jira";
import { calcomConnector } from "./calendar/calcom";
import { googleCalendarConnector } from "./calendar/googleCalendar";
import { vinquliaCalendarConnector } from "./calendar/vinqulia";

export type ConnectorCategory = "crm" | "tickets" | "calendar" | "mcp";

export interface ConnectorFieldSpec {
  name: string;
  label: string;
  placeholder: string;
  type?: "text" | "password";
  /** Va a `config` (no-secreto) en vez de a Vault. */
  isConfig?: boolean;
  /** Se puede dejar vacío — sin esto, connectConnector() lo exige y bloquea la conexión. */
  optional?: boolean;
}

export interface ConnectorMeta {
  id: string;
  category: ConnectorCategory;
  name: string;
  icon: string;
  desc: string;
  comingSoon?: boolean;
  /** "apikey" (default): formulario con token. "oauth": botón que redirige al consentimiento del proveedor. */
  authType?: "apikey" | "oauth";
  steps?: string[];
  apiKeyLabel?: string;
  apiKeyPlaceholder?: string;
  fields?: ConnectorFieldSpec[];
  /** Solo oauth: config que se completa DESPUÉS de conectar (ej. a qué proyecto de Jira caen los tickets). */
  postAuthFields?: ConnectorFieldSpec[];
}

/**
 * En cuántas horas vence la tarea de llamada que acompaña a cada oportunidad
 * nueva. Igual en los tres CRMs, así que se declara una vez — ver
 * src/connectors/followupTask.ts para por qué la tarea es automática.
 */
const SEGUIMIENTO_FIELD: ConnectorFieldSpec = {
  name: "followupHours",
  label: "Horas para llamar a un lead nuevo (opcional)",
  placeholder: "24",
  isConfig: true,
  optional: true,
};

export const CRM_PROVIDERS: Record<string, ConnectorMeta> = {
  vinqulia: {
    id: "vinqulia",
    category: "crm",
    name: "Vinqulia",
    icon: "target",
    desc: "Los leads del bot se dan de alta como contactos en tu Vinqulia.",
    steps: [
      'En Vinqulia: <span class="font-mono">Ajustes → API</span>, crea una clave de API y cópiala.',
      "Pega la dirección de tu Vinqulia — solo el dominio, sin rutas (ej. <span class=\"font-mono\">https://crm.miempresa.com</span>).",
      'El <b>ID del vendedor</b> es opcional: si lo pones, los contactos que cree el bot quedan asignados a esa persona (lo ves en <span class="font-mono">Ajustes → Equipo</span>).',
      'Ya conectado, usa el botón <b>"Configurar etapa inicial"</b> para elegir en qué pipeline y etapa caen las oportunidades que cree el bot. Sin eso registra el contacto pero NO la oportunidad.',
    ],
    apiKeyLabel: "Clave de API",
    apiKeyPlaceholder: "········",
    // El pipeline y la etapa NO se piden aquí como texto: Vinqulia guarda por
    // value interno ("ventas", "opportunity") y muestra por label ("Ventas",
    // "Oportunidad"). Al teclearlos, el dueño escribe lo que ve y la
    // oportunidad queda guardada donde su tablero no la dibuja — pasó en
    // producción. Ahora salen de un selector poblado con su propia
    // configuración (ver listPipelineStages en crm/vinqulia.ts).
    fields: [
      { name: "url", label: "Dirección de tu Vinqulia", placeholder: "https://crm.miempresa.com", isConfig: true },
      { name: "salesId", label: "ID del vendedor (opcional)", placeholder: "1", isConfig: true, optional: true },
      SEGUIMIENTO_FIELD,
    ],
  },
  hubspot: {
    id: "hubspot",
    category: "crm",
    name: "HubSpot",
    icon: "target",
    desc: "Los leads del bot se dan de alta como contactos en tu HubSpot.",
    steps: [
      'En HubSpot: <span class="font-mono">Configuración → Integraciones → Apps privadas</span>, crea una app privada con el scope <span class="font-mono">crm.objects.contacts.write</span> y <span class="font-mono">crm.objects.contacts.read</span>.',
      "Copia el token de acceso que te da (empieza con \"pat-\") y pégalo aquí abajo.",
    ],
    apiKeyLabel: "Token de la app privada",
    apiKeyPlaceholder: "pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    fields: [SEGUIMIENTO_FIELD],
  },
  pipedrive: {
    id: "pipedrive",
    category: "crm",
    name: "Pipedrive",
    icon: "target",
    desc: "Los leads del bot se dan de alta como personas en tu Pipedrive.",
    steps: [
      'En Pipedrive: <span class="font-mono">Configuración → Personal → API</span>, copia tu API token.',
      "Pega también el subdominio de tu empresa (la parte antes de \".pipedrive.com\" en tu URL).",
    ],
    apiKeyLabel: "API token",
    apiKeyPlaceholder: "········",
    fields: [
      { name: "domain", label: "Subdominio de tu empresa", placeholder: "miempresa", isConfig: true },
      SEGUIMIENTO_FIELD,
    ],
  },
  twenty: {
    id: "twenty",
    category: "crm",
    name: "Twenty",
    icon: "target",
    desc: "CRM open source — próximamente.",
    comingSoon: true,
  },
};

export const TICKET_PROVIDERS: Record<string, ConnectorMeta> = {
  // Id distinto al del CRM a propósito: bot_connectors es único por
  // (bot_id, provider) y categoryOfProvider() resuelve la categoría por el id
  // — con el mismo "vinqulia" en ambas, conectar una borraría la otra.
  "vinqulia-tickets": {
    id: "vinqulia-tickets",
    category: "tickets",
    name: "Vinqulia",
    icon: "life-buoy",
    desc: "Los handoffs del bot se abren como tickets en tu Vinqulia.",
    steps: [
      'En Vinqulia: <span class="font-mono">Ajustes → API</span>, crea una clave de API y cópiala.',
      "Pega la dirección de tu Vinqulia — solo el dominio, sin rutas (ej. <span class=\"font-mono\">https://crm.miempresa.com</span>).",
      "Si ya conectaste Vinqulia como CRM, aquí van los mismos datos: son conexiones separadas (una para leads, otra para tickets).",
    ],
    apiKeyLabel: "Clave de API",
    apiKeyPlaceholder: "········",
    fields: [
      { name: "url", label: "Dirección de tu Vinqulia", placeholder: "https://crm.miempresa.com", isConfig: true },
      { name: "salesId", label: "ID del vendedor (opcional)", placeholder: "1", isConfig: true, optional: true },
    ],
  },
  zendesk: {
    id: "zendesk",
    category: "tickets",
    name: "Zendesk",
    icon: "life-buoy",
    desc: "Los handoffs del bot se crean como tickets en tu Zendesk.",
    steps: [
      'En Zendesk: <span class="font-mono">Admin Center → Apps y integraciones → APIs → Tokens de API</span>, crea uno nuevo.',
      "Pega el subdominio (la parte antes de \".zendesk.com\") y el email del agente dueño del token.",
    ],
    apiKeyLabel: "Token de API",
    apiKeyPlaceholder: "········",
    fields: [
      { name: "subdomain", label: "Subdominio de Zendesk", placeholder: "miempresa", isConfig: true },
      { name: "email", label: "Email del agente", placeholder: "tu@empresa.com", isConfig: true },
    ],
  },
  freshdesk: {
    id: "freshdesk",
    category: "tickets",
    name: "Freshdesk",
    icon: "life-buoy",
    desc: "Próximamente.",
    comingSoon: true,
  },
  jira: {
    id: "jira",
    category: "tickets",
    name: "Jira",
    icon: "life-buoy",
    desc: "Los handoffs del bot se crean como incidencias en tu Jira.",
    authType: "oauth",
    postAuthFields: [{ name: "projectKey", label: "Project Key", placeholder: "SUP", isConfig: true }],
  },
};

export const CALENDAR_PROVIDERS: Record<string, ConnectorMeta> = {
  // Id distinto al del CRM y al de tickets, por lo mismo que "vinqulia-tickets":
  // bot_connectors es único por (bot_id, provider), así que compartir el id
  // haría que conectar el calendario desconectara el CRM.
  "vinqulia-calendar": {
    id: "vinqulia-calendar",
    category: "calendar",
    name: "Vinqulia",
    icon: "calendar-clock",
    desc: "Las citas del agente quedan como tareas con fecha en tu Vinqulia.",
    steps: [
      'En Vinqulia: <span class="font-mono">Ajustes → API</span>, crea una clave de API y cópiala.',
      "Pega la dirección de tu Vinqulia — solo el dominio, sin rutas (ej. <span class=\"font-mono\">https://crm.miempresa.com</span>).",
      "Si ya conectaste Vinqulia como CRM, aquí van los mismos datos: son conexiones separadas (una para leads, otra para la agenda).",
      "Cada cita se cuelga de la persona en el CRM. Si todavía no existe ahí, el agente la da de alta con lo que sepa de ella.",
    ],
    apiKeyLabel: "Clave de API",
    apiKeyPlaceholder: "········",
    fields: [
      { name: "url", label: "Dirección de tu Vinqulia", placeholder: "https://crm.miempresa.com", isConfig: true },
      { name: "salesId", label: "ID del vendedor (opcional)", placeholder: "1", isConfig: true, optional: true },
      {
        name: "taskType",
        label: "Tipo de tarea (opcional)",
        placeholder: "follow-up",
        isConfig: true,
        optional: true,
      },
    ],
  },
  calcom: {
    id: "calcom",
    category: "calendar",
    name: "Cal.com",
    icon: "calendar-clock",
    desc: "El agente agenda citas directo en tu Cal.com.",
    steps: [
      'En Cal.com: <span class="font-mono">Settings → Developer → API Keys</span>, crea una nueva.',
      'Ve al tipo de evento donde quieres que caigan las citas del bot y copia su <b>Event Type ID</b> (aparece en la URL del editor, ej. <span class="font-mono">cal.com/event-types/12345</span> → 12345).',
    ],
    apiKeyLabel: "API Key",
    apiKeyPlaceholder: "cal_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    fields: [{ name: "eventTypeId", label: "Event Type ID", placeholder: "12345", isConfig: true }],
  },
  "google-calendar": {
    id: "google-calendar",
    category: "calendar",
    name: "Google Calendar",
    icon: "calendar-clock",
    desc: "El agente agenda citas directo en tu Google Calendar.",
    authType: "oauth",
    postAuthFields: [
      { name: "calendarId", label: "Calendario (opcional)", placeholder: "primary", isConfig: true },
      { name: "durationMinutes", label: "Duración de cada cita en minutos (opcional)", placeholder: "30", isConfig: true },
    ],
  },
};
export const MCP_PROVIDERS: Record<string, ConnectorMeta> = {};

export const CRM_ADAPTERS: Record<string, CrmConnector> = {
  vinqulia: vinquliaConnector,
  hubspot: hubspotConnector,
  pipedrive: pipedriveConnector,
};
export const TICKET_ADAPTERS: Record<string, TicketConnector> = {
  "vinqulia-tickets": vinquliaTicketConnector,
  zendesk: zendeskConnector,
  jira: jiraConnector,
};
export const CALENDAR_ADAPTERS: Record<string, CalendarConnector> = {
  calcom: calcomConnector,
  "google-calendar": googleCalendarConnector,
  "vinqulia-calendar": vinquliaCalendarConnector,
};

export const CATEGORY_LABELS: Record<ConnectorCategory, string> = {
  crm: "CRM",
  tickets: "Tickets",
  calendar: "Calendario",
  mcp: "Conectores MCP",
};

/** Busca la ficha de un proveedor en cualquier categoría — usado donde solo se tiene (category, provider), como al refrescar credenciales OAuth. */
export function metaFor(category: ConnectorCategory, provider: string): ConnectorMeta | undefined {
  if (category === "crm") return CRM_PROVIDERS[provider];
  if (category === "tickets") return TICKET_PROVIDERS[provider];
  if (category === "calendar") return CALENDAR_PROVIDERS[provider];
  return MCP_PROVIDERS[provider];
}
