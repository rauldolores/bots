import { Db } from "./client";

export interface Lead {
  id: string;
  bot_id: string;
  conversation_id: string | null;
  name: string | null;
  contact: string | null;
  channel_user_id: string | null;
  intent: string;
  notes: string | null;
  status: "new" | "contacted" | "sold" | "lost";
  exported_to: string | null;
  external_id: string | null;
  /** JSON con los campos propios del nicho (o null). Ver leadMetadata(). */
  metadata: string | null;
  /** F8 fase C: secuencia de seguimiento activa (null = no está en ninguna). */
  sequence_id: string | null;
  /** Informativo — quien de verdad decide cuándo se procesa un toque es work_jobs.run_after. */
  next_touch_at: number | null;
  /** Por qué se frenó la última secuencia (o esta, si sigue detenida). Ver la migración f8c. */
  stopped_reason: string | null;
  created_at: number;
  updated_at: number;
}

export interface CreateLeadInput {
  conversationId: string | null;
  channelUserId: string | null;
  name?: string;
  contact?: string;
  intent: string;
  notes?: string;
  /** Campos propios del nicho; se serializan a JSON en la columna metadata. */
  metadata?: Record<string, string | number | null>;
}

/** Parsea el JSON de metadata de un lead a un objeto plano (vacío si no hay/está roto). */
export function leadMetadata(lead: Pick<Lead, "metadata">): Record<string, string> {
  if (!lead.metadata) return {};
  try {
    const o = JSON.parse(lead.metadata);
    if (!o || typeof o !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) {
      if (v !== null && v !== undefined) out[k] = String(v);
    }
    return out;
  } catch {
    return {};
  }
}

export class LeadsRepo {
  constructor(
    private readonly db: Db,
    private readonly botId: string,
  ) {}

  async create(input: CreateLeadInput): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const metadata =
      input.metadata && Object.keys(input.metadata).length > 0
        ? JSON.stringify(input.metadata)
        : null;
    await this.db.run(
      `INSERT INTO leads (id, bot_id, conversation_id, name, contact, channel_user_id, intent, notes, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        this.botId,
        input.conversationId,
        input.name ?? null,
        input.contact ?? null,
        input.channelUserId,
        input.intent,
        input.notes ?? null,
        metadata,
        now,
        now,
      ],
    );
    return id;
  }

  async list(limit: number, status?: string): Promise<Lead[]> {
    if (status) {
      return this.db.all<Lead>(
        "SELECT * FROM leads WHERE bot_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?",
        [this.botId, status, limit],
      );
    }
    return this.db.all<Lead>(
      "SELECT * FROM leads WHERE bot_id = ? ORDER BY created_at DESC LIMIT ?",
      [this.botId, limit],
    );
  }

  async setStatus(id: string, status: Lead["status"]): Promise<void> {
    await this.db.run(
      "UPDATE leads SET status = ?, updated_at = ? WHERE id = ? AND bot_id = ?",
      [status, Date.now(), id, this.botId],
    );
  }

  async getById(id: string): Promise<Lead | null> {
    return this.db.first<Lead>("SELECT * FROM leads WHERE id = ? AND bot_id = ?", [id, this.botId]);
  }

  /**
   * El lead ABIERTO (new/contacted) más reciente que ya tiene alguna de estas
   * direcciones normalizadas (E.164 o correo en minúsculas) en lead_contacts —
   * evita que captureLeadTool cree un segundo lead cuando el mismo cliente
   * insiste en la misma conversación o escribe otra vez por un canal distinto
   * con el mismo teléfono. 'sold'/'lost' NO cuenta: si vuelve después de
   * cerrado es una intención nueva, no la continuación de la anterior.
   */
  async findOpenByContactAddress(addressNorms: string[]): Promise<Lead | null> {
    if (addressNorms.length === 0) return null;
    const marcas = addressNorms.map(() => "?").join(", ");
    return this.db.first<Lead>(
      `SELECT leads.* FROM leads
       JOIN lead_contacts ON lead_contacts.lead_id = leads.id AND lead_contacts.bot_id = leads.bot_id
       WHERE leads.bot_id = ? AND leads.status IN ('new', 'contacted')
         AND lead_contacts.address_norm IN (${marcas})
       ORDER BY leads.created_at DESC LIMIT 1`,
      [this.botId, ...addressNorms],
    );
  }

  /**
   * Actualiza un lead existente con lo que trae una segunda captura del MISMO
   * cliente (ver findOpenByContactAddress) en vez de crear una fila duplicada.
   * name/contact solo se llenan si faltaban — no se pisa un dato bueno con
   * uno vacío o distinto; intent/notes se ACUMULAN para no perder historial;
   * metadata (empresa/presupuesto estimado, F-CRM-completo) rellena claves
   * vacías sin pisar un valor que ya se tenía.
   */
  async mergeCapture(
    id: string,
    input: {
      name?: string;
      contact?: string;
      intent: string;
      notes?: string;
      metadata?: Record<string, string | number | null>;
    },
  ): Promise<void> {
    const current = await this.getById(id);
    if (!current) return;
    const intent =
      current.intent && input.intent && current.intent !== input.intent
        ? `${current.intent}\n${input.intent}`
        : current.intent || input.intent;
    const notes = [current.notes, input.notes].filter((v) => v && v.trim() !== "").join("\n") || null;
    const currentMeta = leadMetadata(current);
    const merged: Record<string, string> = { ...currentMeta };
    for (const [k, v] of Object.entries(input.metadata ?? {})) {
      if (!merged[k] && v !== null && v !== undefined) merged[k] = String(v);
    }
    const metadata = Object.keys(merged).length > 0 ? JSON.stringify(merged) : current.metadata;
    await this.db.run(
      `UPDATE leads SET name = ?, contact = ?, intent = ?, notes = ?, metadata = ?, updated_at = ?
       WHERE id = ? AND bot_id = ?`,
      [
        current.name ?? input.name ?? null,
        current.contact ?? input.contact ?? null,
        intent,
        notes,
        metadata,
        Date.now(),
        id,
        this.botId,
      ],
    );
  }

  /** Inscribe (o reinscribe) un lead en una secuencia — arranca desde el paso 0. */
  async startSequence(id: string, sequenceId: string, nextTouchAt: number): Promise<void> {
    await this.db.run(
      `UPDATE leads SET sequence_id = ?, next_touch_at = ?, stopped_reason = NULL, updated_at = ?
       WHERE id = ? AND bot_id = ?`,
      [sequenceId, nextTouchAt, Date.now(), id, this.botId],
    );
  }

  /** Avanza al siguiente toque programado (o null si la secuencia ya terminó). */
  async setNextTouch(id: string, nextTouchAt: number | null): Promise<void> {
    await this.db.run("UPDATE leads SET next_touch_at = ?, updated_at = ? WHERE id = ? AND bot_id = ?", [
      nextTouchAt,
      Date.now(),
      id,
      this.botId,
    ]);
  }

  /** Frena la persecución — por brake, por completarse, o porque el dueño la detuvo a mano. */
  async stopSequence(id: string, reason: string): Promise<void> {
    await this.db.run(
      `UPDATE leads SET sequence_id = NULL, next_touch_at = NULL, stopped_reason = ?, updated_at = ?
       WHERE id = ? AND bot_id = ?`,
      [reason, Date.now(), id, this.botId],
    );
  }

  async setExported(id: string, target: string, externalId: string): Promise<void> {
    await this.db.run(
      "UPDATE leads SET exported_to = ?, external_id = ?, updated_at = ? WHERE id = ? AND bot_id = ?",
      [target, externalId, Date.now(), id, this.botId],
    );
  }

  /**
   * El lead más reciente con nombre o contacto para este channel_user_id — para
   * que el bot no le vuelva a preguntar su nombre a alguien que ya lo dio en una
   * conversación anterior (misma cuenta de WhatsApp/Telegram/etc., semanas o
   * meses después). Null si nunca se capturó nada identificable de esta cuenta.
   */
  async findLatestByChannelUserId(channelUserId: string): Promise<Lead | null> {
    return this.db.first<Lead>(
      `SELECT * FROM leads WHERE bot_id = ? AND channel_user_id = ? AND (name IS NOT NULL OR contact IS NOT NULL)
       ORDER BY created_at DESC LIMIT 1`,
      [this.botId, channelUserId],
    );
  }

  /**
   * El contacto ya capturado (por captureLead) en ESTA conversación — para
   * que handoffHuman no le vuelva a pedir su teléfono/correo a alguien que
   * ya lo dio hace un momento, dos tools después.
   */
  async findContactByConversation(conversationId: string): Promise<string | null> {
    const row = await this.db.first<{ contact: string }>(
      `SELECT contact FROM leads WHERE bot_id = ? AND conversation_id = ? AND contact IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      [this.botId, conversationId],
    );
    return row?.contact ?? null;
  }
}
