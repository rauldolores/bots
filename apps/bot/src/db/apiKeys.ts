// F8: llaves de API por bot — la credencial que presenta un sistema externo
// para invocar una habilidad.
//
// Se guarda el HASH, nunca el texto. Para verificar algo que ENTRA basta
// comparar digests; Vault (bot_channels.secret_ref) es lo correcto para
// credenciales que el bot necesita descifrar para SALIR, como el token de
// Twilio. El texto de la llave se le muestra al dueño UNA sola vez.
import { Db } from "./client";

export interface BotApiKey {
  id: string;
  bot_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  enabled: boolean;
  created_at: number;
  last_used_at: number | null;
}

/** Largo FIJO a propósito: tokensMatch sale temprano si los largos difieren, así que un largo variable filtraría información por tiempo. */
const SECRET_HEX_CHARS = 48;
const PREFIX_CHARS = 8;

function randomHex(chars: number): string {
  const bytes = new Uint8Array(chars / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** SHA-256 vía Web Crypto — disponible igual en Node 18+, Cloudflare y Vercel. */
export async function hashApiKey(plaintext: string): Promise<string> {
  const data = new TextEncoder().encode(plaintext);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface GeneratedApiKey {
  /** Se muestra UNA vez y no se vuelve a poder recuperar. */
  plaintext: string;
  prefix: string;
  hash: string;
}

export async function generateApiKey(): Promise<GeneratedApiKey> {
  const prefix = randomHex(PREFIX_CHARS);
  const secret = randomHex(SECRET_HEX_CHARS);
  // El prefijo viaja dentro de la llave para poder localizar la fila sin
  // tener que probar el hash contra todas.
  const plaintext = `na_${prefix}_${secret}`;
  return { plaintext, prefix, hash: await hashApiKey(plaintext) };
}

/** Saca el prefijo de una llave presentada. null si no tiene la forma esperada. */
export function prefixOf(plaintext: string): string | null {
  const m = /^na_([0-9a-f]{8})_[0-9a-f]{48}$/.exec(plaintext.trim());
  return m ? m[1] : null;
}

export class BotApiKeysRepo {
  constructor(private readonly db: Db) {}

  /** Búsqueda GLOBAL por prefijo (como voiceNumbers.findByNumber): quien llama todavía no dice qué bot es — lo dice la llave. */
  async findByPrefix(prefix: string): Promise<BotApiKey | null> {
    return this.db.first<BotApiKey>("SELECT * FROM bot_api_keys WHERE key_prefix = ?", [prefix]);
  }

  async create(botId: string, name: string): Promise<{ id: string; plaintext: string }> {
    const { plaintext, prefix, hash } = await generateApiKey();
    const id = crypto.randomUUID();
    await this.db.run(
      `INSERT INTO bot_api_keys (id, bot_id, name, key_prefix, key_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, botId, name, prefix, hash, Date.now()],
    );
    return { id, plaintext };
  }

  async listByBot(botId: string): Promise<BotApiKey[]> {
    return this.db.all<BotApiKey>(
      "SELECT * FROM bot_api_keys WHERE bot_id = ? ORDER BY created_at DESC",
      [botId],
    );
  }

  /** Revocación reversible: no se borra la fila para no perder el rastro de quién estuvo llamando. */
  async setEnabled(id: string, botId: string, enabled: boolean): Promise<void> {
    await this.db.run("UPDATE bot_api_keys SET enabled = ? WHERE id = ? AND bot_id = ?", [
      enabled,
      id,
      botId,
    ]);
  }

  /** El hash es también el secreto con el que se firman los callbacks — ver src/skills/sign.ts. */
  async hashById(id: string): Promise<string | null> {
    const row = await this.db.first<{ key_hash: string }>(
      "SELECT key_hash FROM bot_api_keys WHERE id = ?",
      [id],
    );
    return row?.key_hash ?? null;
  }

  async touchLastUsed(id: string): Promise<void> {
    await this.db.run("UPDATE bot_api_keys SET last_used_at = ? WHERE id = ?", [Date.now(), id]);
  }
}
