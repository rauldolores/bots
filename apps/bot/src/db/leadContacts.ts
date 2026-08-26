// F8 fase B: por dónde se le puede escribir a un lead.
//
// Complementa a `leads.contact` (una columna de texto libre que el LLM llena
// con "teléfono o email"), no la reemplaza: aquí el dato ya viene tipado y
// normalizado, que es lo que hace posible cruzarlo y consultarlo.
import { Db } from "./client";
import type { ContactKind } from "../contacts/normalize";

export type ContactConsent = "inbound" | "explicit" | "unknown";

export interface LeadContact {
  id: string;
  bot_id: string;
  lead_id: string;
  kind: ContactKind;
  channel: string | null;
  address_raw: string;
  address_norm: string;
  consent: ContactConsent;
  verified: boolean;
  created_at: number;
}

export interface AddContactInput {
  leadId: string;
  kind: ContactKind;
  channel?: string | null;
  addressRaw: string;
  addressNorm: string;
  consent?: ContactConsent;
  verified?: boolean;
}

export class LeadContactsRepo {
  constructor(
    private readonly db: Db,
    private readonly botId: string,
  ) {}

  /**
   * Alta idempotente: el mismo contacto capturado dos veces no duplica la
   * fila. Se apoya en el UNIQUE(bot_id, lead_id, kind, address_norm) — capturar
   * un lead es algo que el agente hace seguido y sin coordinación.
   */
  async add(input: AddContactInput): Promise<void> {
    await this.db.run(
      `INSERT INTO lead_contacts (id, bot_id, lead_id, kind, channel, address_raw, address_norm, consent, verified, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (bot_id, lead_id, kind, address_norm) DO NOTHING`,
      [
        crypto.randomUUID(),
        this.botId,
        input.leadId,
        input.kind,
        input.channel ?? null,
        input.addressRaw,
        input.addressNorm,
        input.consent ?? "unknown",
        input.verified ?? false,
        Date.now(),
      ],
    );
  }

  async listByLead(leadId: string): Promise<LeadContact[]> {
    return this.db.all<LeadContact>(
      "SELECT * FROM lead_contacts WHERE bot_id = ? AND lead_id = ? ORDER BY created_at ASC",
      [this.botId, leadId],
    );
  }

  /**
   * De quién es esta dirección. Acepta varias formas del mismo número (ver
   * phoneVariants) porque el mismo teléfono se guardó distinto según el canal
   * por el que llegó.
   */
  async findByAddress(variants: string[]): Promise<LeadContact[]> {
    if (variants.length === 0) return [];
    const marcas = variants.map(() => "?").join(", ");
    return this.db.all<LeadContact>(
      `SELECT * FROM lead_contacts WHERE bot_id = ? AND address_norm IN (${marcas}) ORDER BY created_at DESC`,
      [this.botId, ...variants],
    );
  }
}
