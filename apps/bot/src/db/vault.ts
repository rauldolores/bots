import { Db } from "./client";

// Supabase Vault: guarda secretos cifrados en `vault.secrets` y los expone
// descifrados SOLO a través de `vault.decrypted_secrets` (una vista, nunca la
// tabla base). F3/F4 de docs/multitenancy.md — decisión M2: con más de un
// bot, un token en texto plano en una columna normal deja de ser un riesgo
// propio y pasa a ser el de los clientes.
//
// `secret_ref` en bot_channels/org_ai_keys es el UUID que devuelve
// createSecret() — nunca el valor en claro.

/**
 * Crea el secreto o, si ya hay uno con ese NOMBRE, lo actualiza y devuelve el
 * mismo id.
 *
 * Vault tiene un índice único en `name`, y nuestros nombres son
 * `<propósito>:<botId>`: el mismo nombre ES el mismo secreto lógico. Antes
 * esto siempre intentaba crear, y cualquier camino que dejara un secreto
 * huérfano con su nombre hacía que la SIGUIENTE conexión tronara con un
 * error de Postgres sin manejar. Caminos reales que lo hacían:
 *
 *  - cambiar el correo de Resend a Mailgun y volver a Resend;
 *  - desconectar un canal cuando el borrado del secreto fallaba en silencio
 *    (va con `.catch`) y luego reconectarlo.
 *
 * Se intenta crear primero y solo ante la violación de unicidad se busca y se
 * actualiza: el caso común cuesta una consulta, y dos altas simultáneas con el
 * mismo nombre no truenan.
 */
export async function createSecret(db: Db, value: string, name?: string): Promise<string> {
  try {
    const row = await db.first<{ id: string }>(
      "SELECT vault.create_secret(?, ?) AS id",
      [value, name ?? null],
    );
    if (!row) throw new Error("vault.create_secret no devolvió id");
    return row.id;
  } catch (e) {
    // 23505 = unique_violation. Sin nombre no puede chocar, así que solo aplica con nombre.
    if (!name || (e as { code?: string })?.code !== "23505") throw e;
    const existente = await db.first<{ id: string }>(
      "SELECT id FROM vault.secrets WHERE name = ?",
      [name],
    );
    if (!existente) throw e;
    await updateSecret(db, existente.id, value);
    return existente.id;
  }
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
