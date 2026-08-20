import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { BotsRepo } from "../../src/db/bots";

let db: Db;
let repo: BotsRepo;

beforeEach(async () => {
  db = await createTestDb();
  repo = new BotsRepo(db);
});

describe("BotsRepo.listByOrganization", () => {
  it("solo devuelve bots de esa organización, más viejo primero", async () => {
    // TEST_BOT_ID vive en su propia organización (organization_id = TEST_BOT_ID,
    // ver pgSetup) — le agregamos un segundo bot a la MISMA organización y uno
    // a otra distinta, para probar el filtro y el orden.
    const now = Date.now();
    await db.run(
      `INSERT INTO bots (id, organization_id, slug, name, business_name, created_at, updated_at)
       VALUES (?, ?, 'segundo', 'Segundo', 'Negocio 2', ?, ?)`,
      ["00000000-0000-0000-0000-0000000000a2", TEST_BOT_ID, now + 1000, now + 1000],
    );
    await db.run(
      `INSERT INTO bots (id, organization_id, slug, name, business_name, created_at, updated_at)
       VALUES (?, ?, 'otra-org', 'De otra org', 'Negocio 3', ?, ?)`,
      ["00000000-0000-0000-0000-0000000000a3", "00000000-0000-0000-0000-0000000000a3", now, now],
    );

    const bots = await repo.listByOrganization(TEST_BOT_ID);
    expect(bots.map((b) => b.id)).toEqual([TEST_BOT_ID, "00000000-0000-0000-0000-0000000000a2"]);
  });

  it("organización sin bots: lista vacía, no un error", async () => {
    const bots = await repo.listByOrganization("00000000-0000-0000-0000-000000000000");
    expect(bots).toEqual([]);
  });
});

describe("BotsRepo.create", () => {
  it("crea el bot con defaults sensatos y un slug derivado del nombre", async () => {
    const org = "00000000-0000-0000-0000-0000000000b1";
    const bot = await repo.create(org, { name: "Sofía", businessName: "Taquería El Buen Sazón" });
    expect(bot.organization_id).toBe(org);
    expect(bot.name).toBe("Sofía");
    expect(bot.business_name).toBe("Taquería El Buen Sazón");
    expect(bot.slug).toBe("sofia");
    expect(bot.tier).toBe("free");
    expect(bot.language).toBe("es");
  });

  it("dos bots con el mismo nombre en la misma organización: el slug se desambigua", async () => {
    const org = "00000000-0000-0000-0000-0000000000b2";
    const a = await repo.create(org, { name: "Sofía", businessName: "Negocio A" });
    const b = await repo.create(org, { name: "Sofía", businessName: "Negocio B" });
    expect(a.slug).toBe("sofia");
    expect(b.slug).toBe("sofia-2");
  });

  it("el mismo nombre en OTRA organización no choca — el slug es único por organización", async () => {
    const orgA = "00000000-0000-0000-0000-0000000000b3";
    const orgB = "00000000-0000-0000-0000-0000000000b4";
    const a = await repo.create(orgA, { name: "Sofía", businessName: "Negocio A" });
    const b = await repo.create(orgB, { name: "Sofía", businessName: "Negocio B" });
    expect(a.slug).toBe("sofia");
    expect(b.slug).toBe("sofia");
  });
});
