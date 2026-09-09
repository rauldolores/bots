/**
 * La aplicación OAuth del dueño capturada desde el panel.
 *
 * El caso (2026-09-09): la tarjeta de Google Calendar y la de Jira decían
 * "Falta configurar GOOGLE_CALENDAR_CLIENT_ID (y su _SECRET) en este
 * despliegue" — un mensaje sobre el servidor, dirigido a alguien que no lo
 * administra. Textual del dueño: "esos datos los debería de pedir para
 * capturarlos, no pedir que vengan como variables de entorno".
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, createSecondTestBot, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import type { Env } from "../../src/env";
import { envConAppOAuth, tieneAppOAuth, guardarAppOAuth, clientIdGuardado } from "../../src/connectors/oauthApp";

// Sin mock de Vault: el secreto de la app se guarda cifrado de verdad (ver
// db/settingsSecretos.test.ts). Cifrar es una función de la base, no código
// nuestro, y lo que importa comprobar aquí es justo que el valor VUELVE
// descifrado — si no, se mandaría "vault:…" a Google como si fuera el secreto.

let db: Db;
let env: Env;

beforeEach(async () => {
  db = await createTestDb();
  env = { DB: db.driver } as unknown as Env;
});

describe("envConAppOAuth", () => {
  it("sin nada capturado, deja el env del despliegue tal cual", async () => {
    const base = { ...env, GOOGLE_CALENDAR_CLIENT_ID: "del-servidor", GOOGLE_CALENDAR_CLIENT_SECRET: "s" } as Env;
    const r = await envConAppOAuth(base, db, TEST_BOT_ID, "google-calendar");
    expect(r.GOOGLE_CALENDAR_CLIENT_ID).toBe("del-servidor");
  });

  it("lo capturado en el panel MANDA sobre lo del servidor — para poder corregirlo sin tocarlo", async () => {
    await guardarAppOAuth(db, TEST_BOT_ID, "google-calendar", "del-panel", "secreto-del-panel");
    const base = { ...env, GOOGLE_CALENDAR_CLIENT_ID: "del-servidor", GOOGLE_CALENDAR_CLIENT_SECRET: "s" } as Env;

    const r = await envConAppOAuth(base, db, TEST_BOT_ID, "google-calendar");

    expect(r.GOOGLE_CALENDAR_CLIENT_ID).toBe("del-panel");
    expect(r.GOOGLE_CALENDAR_CLIENT_SECRET).toBe("secreto-del-panel");
  });

  it("con solo la mitad capturada, no mezcla: media credencial da un error que no se parece al problema", async () => {
    await new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.googleCalendarClientId, "del-panel");
    const base = { ...env, GOOGLE_CALENDAR_CLIENT_ID: "del-servidor", GOOGLE_CALENDAR_CLIENT_SECRET: "s" } as Env;

    const r = await envConAppOAuth(base, db, TEST_BOT_ID, "google-calendar");

    expect(r.GOOGLE_CALENDAR_CLIENT_ID).toBe("del-servidor");
  });

  it("nunca muta el env que recibe — es el del proceso, compartido por todos los bots", async () => {
    await guardarAppOAuth(db, TEST_BOT_ID, "jira", "jid", "jsec");
    const base = { ...env } as Env;
    await envConAppOAuth(base, db, TEST_BOT_ID, "jira");
    expect(base.JIRA_CLIENT_ID).toBeUndefined();
  });

  it("la app de un bot no se le aplica a otro", async () => {
    const otroBot = await createSecondTestBot(db);
    await guardarAppOAuth(db, TEST_BOT_ID, "jira", "jid-1", "jsec-1");

    const r = await envConAppOAuth(env, db, otroBot, "jira");

    expect(r.JIRA_CLIENT_ID).toBeUndefined();
  });
});

describe("tieneAppOAuth", () => {
  it("es cierto tanto si viene del panel como del despliegue", async () => {
    expect(await tieneAppOAuth(env, db, TEST_BOT_ID, "jira")).toBe(false);

    const conEnv = { ...env, JIRA_CLIENT_ID: "a", JIRA_CLIENT_SECRET: "b" } as Env;
    expect(await tieneAppOAuth(conEnv, db, TEST_BOT_ID, "jira")).toBe(true);

    await guardarAppOAuth(db, TEST_BOT_ID, "jira", "jid", "jsec");
    expect(await tieneAppOAuth(env, db, TEST_BOT_ID, "jira")).toBe(true);
  });
});

describe("clientIdGuardado", () => {
  it("devuelve el id para volver a mostrarlo en el formulario", async () => {
    await guardarAppOAuth(db, TEST_BOT_ID, "google-calendar", "el-id", "el-secreto");
    expect(await clientIdGuardado(db, TEST_BOT_ID, "google-calendar")).toBe("el-id");
  });

  it("el secreto NO se devuelve nunca: se reescribe, no se muestra", async () => {
    await guardarAppOAuth(db, TEST_BOT_ID, "google-calendar", "el-id", "el-secreto");
    const guardado = await new SettingsRepo(db, TEST_BOT_ID).get(SETTING_KEYS.googleCalendarClientSecret);
    expect(guardado).not.toBe("el-secreto"); // quedó como referencia a Vault
  });
});
