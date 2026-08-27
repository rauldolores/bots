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
  /** Empresa del cliente, solo si la mencionó explícitamente — null/ausente si no se sabe. */
  company?: string | null;
  /** Monto/presupuesto estimado que el cliente mencionó — null/ausente si no se sabe. Nunca se inventa. */
  estimatedValue?: number | null;
  /** Moneda del monto — `bots.config.currency`, default "MXN". Solo importa si estimatedValue no es null. */
  currency?: string;
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

export interface PipelineStageOption {
  id: string;
  label: string;
}

export interface PipelineStageListResult {
  ok: boolean;
  items: PipelineStageOption[];
  error?: string;
}

export interface CrmConnector {
  pushLead(creds: ConnectorCreds, lead: CrmLeadInput): Promise<ConnectorPushResult>;
  listRecent(creds: ConnectorCreds, limit: number): Promise<ConnectorListResult<CrmRecord>>;
  /**
   * Los pipelines/etapas reales de la cuenta conectada — para que el dueño
   * elija en cuál cae la oportunidad inicial desde un selector, en vez de
   * escribir un ID a mano. Ausente en proveedores donde el concepto no aplica
   * o todavía no se implementó (ver el panel: sin este método, no se muestra
   * el botón de "Configurar etapa inicial").
   */
  listPipelineStages?(creds: ConnectorCreds): Promise<PipelineStageListResult>;
}

export interface TicketInput {
  category: string;
  summary: string;
  priority?: "low" | "normal" | "high" | "urgent";
  requesterName?: string | null;
  requesterContact?: string | null;
}

export interface TicketRecord {
  id: string;
  subject: string;
  status: string;
  priority?: string;
  requesterName?: string;
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
