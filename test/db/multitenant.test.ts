/**
 * F1 de docs/multitenancy.md: el modelo de datos multi-tenant.
 *
 * Lo que se prueba aquí es lo que puede salir MAL de forma silenciosa: que el
 * backfill pierda datos de un despliegue que ya estaba en producción, que dos
 * organizaciones puedan pisarse el slug de un bot, o que borrar un bot deje
 * basura colgando.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/pgSetup";
import type { Db } from "../../src/db/client";

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

async function crearBot(org: string, slug: string): Promise<string> {
  const row = await db.first<{ id: string }>(
    `INSERT INTO bots (organization_id, slug, name, business_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    [org, slug, "Asistente", "Negocio", Date.now(), Date.now()],
  );
  return row!.id;
}

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";

describe("bots: una organización, muchos bots", () => {
  it("una organización puede tener varios bots", async () => {
    await crearBot(ORG_A, "ventas");
    await crearBot(ORG_A, "soporte");

    const bots = await db.all("SELECT slug FROM bots WHERE organization_id = ?", [ORG_A]);
    expect(bots).toHaveLength(2);
  });

  it("el slug es único DENTRO de la organización, no globalmente", async () => {
    await crearBot(ORG_A, "ventas");
    // Otra organización puede llamar igual a su bot — si no, el nombre que
    // elige un cliente le quitaría esa opción a todos los demás.
    await expect(crearBot(ORG_B, "ventas")).resolves.toBeTruthy();
    // Pero la misma organización, no.
    await expect(crearBot(ORG_A, "ventas")).rejects.toThrow();
  });
});

describe("bot_channels: credenciales fuera de la tabla", () => {
  it("guarda una referencia a Vault, nunca el token", async () => {
    const bot = await crearBot(ORG_A, "ventas");
    await db.run(
      `INSERT INTO bot_channels (bot_id, channel, external_id, secret_ref, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [bot, "telegram", "9911", "33333333-3333-3333-3333-333333333333", Date.now()],
    );

    const cols = await db.all<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'bot_channels'`,
    );
    const nombres = cols.map((c) => c.column_name);
    // Las columnas de secreto son *_ref (UUID a vault.secrets). Que no exista
    // ninguna columna de texto donde quepa un token es la garantía real.
    expect(nombres).toContain("secret_ref");
    expect(nombres).not.toContain("token");
    expect(nombres).not.toContain("secret");
  });

  it("un bot no puede conectar dos veces el mismo canal", async () => {
    const bot = await crearBot(ORG_A, "ventas");
    const insertar = () =>
      db.run(
        "INSERT INTO bot_channels (bot_id, channel, created_at) VALUES (?, ?, ?)",
        [bot, "telegram", Date.now()],
      );
    await insertar();
    await expect(insertar()).rejects.toThrow();
  });

  it("borrar el bot se lleva sus canales", async () => {
    const bot = await crearBot(ORG_A, "ventas");
    await db.run("INSERT INTO bot_channels (bot_id, channel, created_at) VALUES (?, ?, ?)", [
      bot,
      "telegram",
      Date.now(),
    ]);

    await db.run("DELETE FROM bots WHERE id = ?", [bot]);
    expect(await db.all("SELECT id FROM bot_channels")).toHaveLength(0);
  });
});

// El caso "dos bots, misma clave de settings" NO se prueba aquí: la llave
// única sigue siendo global (settings.key) hasta F2, porque cambiarla ahora
// rompería los ON CONFLICT del código actual. Ver la nota en la migración.

describe("las tablas del bot llevan bot_id", () => {
  it("todas las tablas de datos tienen la columna", async () => {
    const esperadas = [
      "conversations", "messages", "leads", "tickets", "settings",
      "conversation_insights", "kb_docs", "kb_chunks", "improvement_suggestions",
      "followup_sends", "customer_facts", "tracked_links", "keyword_hits",
      "conv_labels", "template_sends", "admin_emails", "magic_links",
      "agent_state", "pending_messages", "agent_jobs",
    ];
    const filas = await db.all<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND column_name = 'bot_id'`,
    );
    const conBotId = new Set(filas.map((f) => f.table_name));
    const faltantes = esperadas.filter((t) => !conBotId.has(t));
    expect(faltantes).toEqual([]);
  });
});
