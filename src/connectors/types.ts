// Contrato común de un conector saliente (CRM/tickets/calendario): el bot ya
// tiene sus propios datos localmente (leads/tickets) — un conector solo
// necesita saber empujar un registro nuevo y listar los recientes, para que
// /admin/leads y /admin/tickets puedan mostrar la plataforma del cliente en
// vez de la tabla local cuando hay una conectada.

/** Credenciales resueltas: el API key ya sacado de Vault + la config no-secreta guardada. */
export interface ConnectorCreds {
  apiKey: string;
  config: Record<string, string>;
}

export interface CrmLeadInput {
  name: string | null;
  contact: string | null;
  intent: string;
  notes: string | null;
}

export interface ConnectorPushResult {
  ok: boolean;
  externalId?: string;
  error?: string;
}

export interface CrmRecord {
  id: string;
  name: string;
  contact: string;
  createdAt: number;
  url?: string;
}

export interface ConnectorListResult<T> {
  ok: boolean;
  items: T[];
  error?: string;
}

export interface CrmConnector {
  pushLead(creds: ConnectorCreds, lead: CrmLeadInput): Promise<ConnectorPushResult>;
  listRecent(creds: ConnectorCreds, limit: number): Promise<ConnectorListResult<CrmRecord>>;
}

export interface TicketInput {
  category: string;
  summary: string;
}

export interface TicketRecord {
  id: string;
  subject: string;
  status: string;
  createdAt: number;
  url?: string;
}

export interface TicketConnector {
  pushTicket(creds: ConnectorCreds, ticket: TicketInput): Promise<ConnectorPushResult>;
  listOpen(creds: ConnectorCreds, limit: number): Promise<ConnectorListResult<TicketRecord>>;
}

export interface AppointmentInput {
  name: string;
  contact: string;
  /** ISO datetime. */
  startTime: string;
  notes?: string;
}

export interface AppointmentRecord {
  id: string;
  name: string;
  contact: string;
  startsAt: number;
  url?: string;
}

export interface CalendarConnector {
  pushAppointment(creds: ConnectorCreds, appt: AppointmentInput): Promise<ConnectorPushResult>;
  listUpcoming(creds: ConnectorCreds, limit: number): Promise<ConnectorListResult<AppointmentRecord>>;
}
