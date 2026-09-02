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
  /** El medio principal, para mostrar. Los dos de abajo son los que se empujan. */
  contact: string | null;
  /** Correo, si lo dio. Se piden los dos por separado — ver captureLead. */
  email?: string | null;
  /** Teléfono, si lo dio (o el del canal por el que escribe). */
  phone?: string | null;
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

/**
 * Lo que el CRM sabe de una persona, para que el agente NO empiece de cero.
 *
 * Se trae completo de una vez (contacto + empresa + oportunidades + últimas
 * notas) porque son varias llamadas HTTP: hacerlas durante el turno costaría
 * segundos de espera al cliente. Por eso se calienta en la ventana del buffer
 * y se guarda en caché — ver src/customer/crmSnapshot.ts.
 */
export interface CrmCustomerSnapshot {
  contactId: string;
  nombre?: string;
  /** Puesto del contacto: cambia cómo se le habla y qué tanto decide. */
  cargo?: string;
  empresa?: { id: string; nombre: string; industria?: string; tamano?: number };
  oportunidades: Array<{
    id: string;
    nombre: string;
    pipeline?: string;
    etapa?: string;
    monto?: number;
    cierreEstimado?: string;
  }>;
  /** Las más recientes primero. Texto ya recortado. */
  notasRecientes: Array<{ fecha?: string; texto: string }>;
  /** Enlace a la ficha en el CRM, para el panel. */
  url?: string;
}

/**
 * Un cambio ya aprobado, listo para escribirse en el CRM (ver src/crm/).
 *
 * El que llama resuelve lo que sale de NUESTRA base (a quién aplica, qué
 * empresa tenía ligada) y el adaptador traduce lo demás al vocabulario de su
 * proveedor — "cargo" será `title` en uno y `jobtitle` en otro. Sin este
 * contrato, esa traducción vivía suelta fuera de la capa de conectores.
 */
export interface CrmChange {
  /** 'nota' | 'contacto' | 'empresa' | 'tarea' | 'etiqueta'… */
  kind: string;
  operation: string;
  /** Los datos del cambio: `{campo, valor}` al actualizar, `{texto}` en una nota. */
  payload: Record<string, unknown>;
  /** Respaldo cuando el payload no trae el valor (propuestas viejas). */
  valorPropuesto?: string | null;
  /** A quién aplica: el id que la caché ya conocía, o su correo/teléfono para buscarlo. */
  contacto: { idEnCrm?: string; dato?: string | null };
  /** La empresa ligada a ese contacto, si la caché la conocía. */
  empresaIdEnCrm?: string;
}

export interface CrmChangeResult {
  ok: boolean;
  detalle: string;
}

export interface CrmConnector {
  pushLead(creds: ConnectorCreds, lead: CrmLeadInput): Promise<ConnectorPushResult>;
  /**
   * Todo lo que el CRM sabe de esta persona. `null` si no la encuentra.
   *
   * Opcional: un proveedor sin esto simplemente no aporta contexto, y el
   * agente sigue con lo que tiene en su propia base.
   */
  lookupCustomer?(creds: ConnectorCreds, buscarPor: { email?: string | null; telefono?: string | null }): Promise<CrmCustomerSnapshot | null>;
  listRecent(creds: ConnectorCreds, limit: number): Promise<ConnectorListResult<CrmRecord>>;
  /**
   * Los pipelines/etapas reales de la cuenta conectada — para que el dueño
   * elija en cuál cae la oportunidad inicial desde un selector, en vez de
   * escribir un ID a mano. Ausente en proveedores donde el concepto no aplica
   * o todavía no se implementó (ver el panel: sin este método, no se muestra
   * el botón de "Configurar etapa inicial").
   */
  listPipelineStages?(creds: ConnectorCreds): Promise<PipelineStageListResult>;
  /**
   * ¿Sabe escribir este tipo de cambio? Sin el método se asume que NO, y
   * entonces ni siquiera se analiza la conversación para proponerlo — el
   * proveedor que no puede recibirlos no debe costarle al dueño una llamada
   * al LLM ni llenarle el panel de propuestas fallidas.
   */
  sabeAplicarCambio?(cambio: Pick<CrmChange, "kind" | "operation" | "payload">): boolean;
  /** Escribe un cambio aprobado. Solo se llama si `sabeAplicarCambio` dijo que sí. */
  aplicarCambio?(creds: ConnectorCreds, cambio: CrmChange): Promise<CrmChangeResult>;
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
  /**
   * Teléfono del cliente, si se conoce. Solo lo usan los calendarios que viven
   * DENTRO del CRM (ver calendar/vinqulia.ts): ahí la cita se cuelga de una
   * persona, y a alguien que llegó por teléfono no se le encuentra por correo.
   */
  phone?: string | null;
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
  /**
   * Cancela/borra una cita ya creada, por el id que devolvió `pushAppointment`.
   *
   * Sin esto, mover una cita dejaba la vieja viva en el calendario del dueño:
   * el agente decía "ya la cambié" y el 2 de septiembre seguía ahí junto al 5.
   * Pasó en producción — el conector solo sabía CREAR.
   *
   * Opcional porque no todo proveedor lo permite; quien llama debe degradar
   * avisándole al cliente en vez de callarse el evento fantasma.
   */
  cancelAppointment?(creds: ConnectorCreds, externalId: string): Promise<{ ok: boolean; error?: string }>;
}
