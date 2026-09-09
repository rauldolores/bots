/**
 * Mueve a Vault las llaves de API que quedaron en texto plano en `settings`.
 *
 * Cuatro ajustes guardan credenciales —el cerebro del bot y su respaldo,
 * Resend, ElevenLabs— y nacieron en claro en una columna normal, mientras el
 * resto de las credenciales del producto (canales, conectores) ya iban
 * cifradas. Con más de un bot eso deja de ser un riesgo propio y pasa a ser
 * el de los clientes.
 *
 * Corre en el cron nocturno y no en un script aparte a propósito: quien
 * instala esto probablemente no sabe programar, y un paso manual es un paso
 * que no se da. Es idempotente — lo ya cifrado se salta— así que correrlo de
 * más no cuesta nada.
 */
import type { Db } from "./client";
import { SETTING_KEYS, SettingsRepo, esRefDeVault } from "./settings";

/**
 * Los ajustes que guardan una credencial. La lista es explícita y corta a
 * propósito: cifrar "todo lo que parezca secreto" adivinando por el nombre
 * acabaría cifrando un ajuste que alguien lee con `all()` sin descifrar, y el
 * síntoma sería una llave "vault:…" mandada como si fuera el valor real.
 */
export const AJUSTES_SECRETOS: readonly string[] = [
  SETTING_KEYS.llmApiKey,
  SETTING_KEYS.llmBackupApiKey,
  SETTING_KEYS.emailOutboundApiKey,
  SETTING_KEYS.voiceElevenLabsApiKey,
  SETTING_KEYS.voiceOpenAiApiKey,
  SETTING_KEYS.googleCalendarClientSecret,
  SETTING_KEYS.jiraClientSecret,
];

/**
 * Cifra las que falten de UN bot. Devuelve cuántas movió.
 *
 * Nunca lanza por una llave suelta: si una falla, las demás igual se
 * protegen. Y no borra nada — `setSecret` reemplaza el valor del ajuste por
 * su referencia, así que el texto plano deja de existir en la tabla.
 */
export async function migrarSecretosDeAjustes(db: Db, botId: string): Promise<number> {
  const repo = new SettingsRepo(db, botId);
  const ajustes = await repo.all();
  let movidas = 0;

  for (const clave of AJUSTES_SECRETOS) {
    const valor = (ajustes[clave] ?? "").trim();
    // Vacío no hay qué cifrar; ya cifrado no hay qué volver a cifrar.
    if (!valor || esRefDeVault(valor)) continue;
    try {
      await repo.setSecret(clave, valor);
      movidas++;
      console.log(`[secretos] ${clave} del bot ${botId} movido a Vault`);
    } catch (e) {
      // A propósito NO se registra el valor: el punto del cambio es que deje
      // de andar suelto, y un log es tan legible como una columna.
      console.error(`[secretos] no se pudo mover ${clave} del bot ${botId}:`, e);
    }
  }
  return movidas;
}
