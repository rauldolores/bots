/**
 * Ajustes que guardan una credencial (el cerebro del bot y su respaldo,
 * Resend, ElevenLabs). Vivían en TEXTO PLANO en la tabla `settings`, mientras
 * el resto de las credenciales del producto ya iban cifradas por Vault.
 *
 * Estas pruebas van contra Postgres de verdad —Vault es una función de la
 * base, no código nuestro— y cubren sobre todo el modo de fallo que importa:
 * si una llave se lee sin descifrar, el bot manda "vault:…" como si fuera la
 * llave y se queda sin proveedor. O sea, deja de responder.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID, createSecondTestBot } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { SettingsRepo, SETTING_KEYS, esRefDeVault } from "../../src/db/settings";
import { migrarSecretosDeAjustes, AJUSTES_SECRETOS } from "../../src/db/migrarSecretos";

let db: Db;
let repo: SettingsRepo;

const LLAVE = "sk-ant-api03-llave-de-prueba";

beforeEach(async () => {
  db = await createTestDb();
  repo = new SettingsRepo(db, TEST_BOT_ID);
});

describe("setSecret / getSecret", () => {
  it("el valor NO queda en claro en la tabla, pero se lee igual", async () => {
    await repo.setSecret(SETTING_KEYS.llmApiKey, LLAVE);

    const crudo = await repo.get(SETTING_KEYS.llmApiKey);
    expect(crudo).not.toBe(LLAVE);
    expect(esRefDeVault(crudo)).toBe(true);
    expect(await repo.getSecret(SETTING_KEYS.llmApiKey)).toBe(LLAVE);
  });

  it("guardar de nuevo reusa la misma entrada de Vault en vez de dejar basura", async () => {
    await repo.setSecret(SETTING_KEYS.llmApiKey, LLAVE);
    const ref = await repo.get(SETTING_KEYS.llmApiKey);

    await repo.setSecret(SETTING_KEYS.llmApiKey, "sk-ant-nueva");
    expect(await repo.get(SETTING_KEYS.llmApiKey)).toBe(ref);
    expect(await repo.getSecret(SETTING_KEYS.llmApiKey)).toBe("sk-ant-nueva");
  });

  // Dejar el cifrado huérfano sería conservar para siempre una llave que el
  // dueño quiso quitar.
  it("vaciarlo borra el secreto y deja el ajuste vacío", async () => {
    await repo.setSecret(SETTING_KEYS.llmApiKey, LLAVE);
    await repo.setSecret(SETTING_KEYS.llmApiKey, "");

    expect(await repo.get(SETTING_KEYS.llmApiKey)).toBe("");
    expect(await repo.getSecret(SETTING_KEYS.llmApiKey)).toBe("");
  });

  // Mientras haya llaves sin migrar, el bot tiene que seguir respondiendo.
  it("una llave todavía en claro se sigue leyendo — nada de días de corte", async () => {
    await repo.set(SETTING_KEYS.llmApiKey, LLAVE);
    expect(await repo.getSecret(SETTING_KEYS.llmApiKey)).toBe(LLAVE);
  });

  it("un ajuste que no existe devuelve null, no truena", async () => {
    expect(await repo.getSecret(SETTING_KEYS.llmApiKey)).toBeNull();
  });
});

describe("allWithSecrets", () => {
  it("descifra los secretos y deja el resto igual", async () => {
    await repo.setSecret(SETTING_KEYS.llmApiKey, LLAVE);
    await repo.set(SETTING_KEYS.botName, "Asesor");

    const todo = await repo.allWithSecrets();
    expect(todo[SETTING_KEYS.llmApiKey]).toBe(LLAVE);
    expect(todo[SETTING_KEYS.botName]).toBe("Asesor");
  });

  it("varios secretos a la vez", async () => {
    await repo.setSecret(SETTING_KEYS.llmApiKey, LLAVE);
    await repo.setSecret(SETTING_KEYS.emailOutboundApiKey, "re_resend_123");
    await repo.setSecret(SETTING_KEYS.voiceElevenLabsApiKey, "sk_eleven_456");

    const todo = await repo.allWithSecrets();
    expect(todo[SETTING_KEYS.llmApiKey]).toBe(LLAVE);
    expect(todo[SETTING_KEYS.emailOutboundApiKey]).toBe("re_resend_123");
    expect(todo[SETTING_KEYS.voiceElevenLabsApiKey]).toBe("sk_eleven_456");
  });

  // Si "vault:…" se colara como valor, se mandaría al proveedor como si fuera
  // la llave y el 401 sería imposible de entender.
  it("NINGÚN valor sale con el prefijo de Vault", async () => {
    await repo.setSecret(SETTING_KEYS.llmApiKey, LLAVE);
    const todo = await repo.allWithSecrets();
    for (const [k, v] of Object.entries(todo)) {
      expect(esRefDeVault(v), `el ajuste ${k} salió sin descifrar`).toBe(false);
    }
  });

  it("un secreto que ya no se puede descifrar sale VACÍO, no como 'vault:…'", async () => {
    await repo.set(SETTING_KEYS.llmApiKey, "vault:00000000-0000-0000-0000-000000000000");
    expect((await repo.allWithSecrets())[SETTING_KEYS.llmApiKey]).toBe("");
  });

  it("sin ningún secreto se comporta igual que all()", async () => {
    await repo.set(SETTING_KEYS.botName, "Asesor");
    expect(await repo.allWithSecrets()).toEqual(await repo.all());
  });

  it("no se cruza con los ajustes de otro bot", async () => {
    await repo.setSecret(SETTING_KEYS.llmApiKey, LLAVE);
    const otroBot = await createSecondTestBot(db);
    expect((await new SettingsRepo(db, otroBot).allWithSecrets())[SETTING_KEYS.llmApiKey]).toBeUndefined();
  });
});

describe("migrarSecretosDeAjustes", () => {
  it("cifra lo que estaba en claro y deja de leerse en la tabla", async () => {
    await repo.set(SETTING_KEYS.llmApiKey, LLAVE);
    await repo.set(SETTING_KEYS.emailOutboundApiKey, "re_123");

    expect(await migrarSecretosDeAjustes(db, TEST_BOT_ID)).toBe(2);
    expect(esRefDeVault(await repo.get(SETTING_KEYS.llmApiKey))).toBe(true);
    expect(esRefDeVault(await repo.get(SETTING_KEYS.emailOutboundApiKey))).toBe(true);
    // Y lo que importa: el valor sigue sirviendo.
    expect(await repo.getSecret(SETTING_KEYS.llmApiKey)).toBe(LLAVE);
    expect(await repo.getSecret(SETTING_KEYS.emailOutboundApiKey)).toBe("re_123");
  });

  // Corre cada noche: si no fuera idempotente, cada corrida crearía una
  // entrada nueva en Vault y dejaría la anterior colgada.
  it("correrla de nuevo no mueve nada ni cambia la referencia", async () => {
    await repo.set(SETTING_KEYS.llmApiKey, LLAVE);
    await migrarSecretosDeAjustes(db, TEST_BOT_ID);
    const ref = await repo.get(SETTING_KEYS.llmApiKey);

    expect(await migrarSecretosDeAjustes(db, TEST_BOT_ID)).toBe(0);
    expect(await repo.get(SETTING_KEYS.llmApiKey)).toBe(ref);
  });

  it("no toca los ajustes vacíos ni los que no son credenciales", async () => {
    await repo.set(SETTING_KEYS.llmApiKey, "");
    await repo.set(SETTING_KEYS.botName, "Asesor");

    expect(await migrarSecretosDeAjustes(db, TEST_BOT_ID)).toBe(0);
    expect(await repo.get(SETTING_KEYS.botName)).toBe("Asesor");
  });

  // La lista es explícita a propósito: cifrar adivinando por el nombre
  // acabaría cifrando algo que alguien lee con all() sin descifrar.
  it("cubre las cuatro llaves que sí tienen valor en producción", () => {
    for (const clave of [
      SETTING_KEYS.llmApiKey,
      SETTING_KEYS.llmBackupApiKey,
      SETTING_KEYS.emailOutboundApiKey,
      SETTING_KEYS.voiceElevenLabsApiKey,
    ]) {
      expect(AJUSTES_SECRETOS).toContain(clave);
    }
  });
});
