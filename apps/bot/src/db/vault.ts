import { Db } from "./client";

// Supabase Vault: guarda secretos cifrados en `vault.secrets` y los expone
// descifrados SOLO a través de `vault.decrypted_secrets` (una vista, nunca la
// tabla base). F3/F4 de docs/multitenancy.md — decisión M2: con más de un
// bot, un token en texto plano en una columna normal deja de ser un riesgo
// propio y pasa a ser el de los clientes.
//
// `secret_ref` en bot_channels/org_ai_keys es el UUID que devuelve
// createSecret() — nunca el valor en claro.

export async function createSecret(db: Db, value: string, name?: string): Promise<string> {
  const row = await db.first<{ id: string }>(
    "SELECT vault.create_secret(?, ?) AS id",
    [value, name ?? null],
  );
  if (!row) throw new Error("vault.create_secret no devolvió id");
  return row.id;
}

export async function readSecret(db: Db, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const row = await db.first<{ decrypted_secret: string }>(
    "SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = ?",
    [id],
  );
  return row?.decrypted_secret ?? null;
}

export async function updateSecret(db: Db, id: string, value: string): Promise<void> {
  await db.run("SELECT vault.update_secret(?, ?)", [id, value]);
}

export async function deleteSecret(db: Db, id: string): Promise<void> {
  await db.run("DELETE FROM vault.secrets WHERE id = ?", [id]);
}
