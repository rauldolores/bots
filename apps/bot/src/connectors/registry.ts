// Catálogo de conectores salientes por categoría — mismo espíritu que
// CHANNEL_META en conexiones.ts (pasos guiados + campos del formulario), pero
// para plataformas que el bot LLAMA (CRM, tickets) en vez de canales que le
// hablan a él. `comingSoon: true` = aparece en la pestaña pero sin botón de
// conectar todavía (honesto sobre lo que ya funciona vs. lo que falta).
import type { CrmConnector, TicketConnector, CalendarConnector } from "./types";
import { hubspotConnector } from "./crm/hubspot";
import { pipedriveConnector } from "./crm/pipedrive";
import { zendeskConnector } from "./tickets/zendesk";
import { jiraConnector } from "./tickets/jira";
import { calcomConnector } from "./calendar/calcom";
import { googleCalendarConnector } from "./calendar/googleCalendar";

export type ConnectorCategory = "crm" | "tickets" | "calendar" | "mcp";

export interface ConnectorFieldSpec {
  name: string;
  label: string;
  placeholder: string;
  type?: "text" | "password";
  /** Va a `config` (no-secreto) en vez de a Vault. */
  isConfig?: boolean;
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

export const CRM_PROVIDERS: Record<string, ConnectorMeta> = {
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
    fields: [{ name: "domain", label: "Subdominio de tu empresa", placeholder: "miempresa", isConfig: true }],
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

export const CRM_ADAPTERS: Record<string, CrmConnector> = { hubspot: hubspotConnector, pipedrive: pipedriveConnector };
export const TICKET_ADAPTERS: Record<string, TicketConnector> = { zendesk: zendeskConnector, jira: jiraConnector };
export const CALENDAR_ADAPTERS: Record<string, CalendarConnector> = { calcom: calcomConnector, "google-calendar": googleCalendarConnector };

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
