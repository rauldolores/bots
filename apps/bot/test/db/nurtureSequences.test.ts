/**
 * nurture_sequences contra Postgres real (un driver simulado no prueba el SQL
 * — ver CLAUDE.md).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, createSecondTestBot, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { NurtureSequencesRepo } from "../../src/db/nurtureSequences";

let db: Db;
let repo: NurtureSequencesRepo;

beforeEach(async () => {
  db = await createTestDb();
  repo = new NurtureSequencesRepo(db, TEST_BOT_ID);
});

describe("NurtureSequencesRepo", () => {
  it("crea y lee una secuencia con sus pasos", async () => {
    const id = await repo.create({
      name: "Recuperar carritos",
      goal: "Que agende su primera clase",
      steps: [
        { afterHours: 3, instruction: "Pregúntale si le quedó alguna duda." },
        { afterHours: 24, instruction: "Ofrécele un descuento del 10%." },
      ],
    });
    const seq = await repo.getById(id);
    expect(seq).toMatchObject({
      name: "Recuperar carritos",
      goal: "Que agende su primera clase",
      enabled: true,
    });
    expect(seq?.steps).toEqual([
      { afterHours: 3, instruction: "Pregúntale si le quedó alguna duda." },
      { afterHours: 24, instruction: "Ofrécele un descuento del 10%." },
    ]);
  });

  it("update reemplaza nombre, objetivo, pasos y enabled", async () => {
    const id = await repo.create({ name: "X", goal: "Y", steps: [{ afterHours: 1, instruction: "a" }] });
    await repo.update(id, {
      name: "X2",
      goal: "Y2",
      steps: [{ afterHours: 5, instruction: "b" }],
      enabled: false,
    });
    const seq = await repo.getById(id);
    expect(seq).toMatchObject({ name: "X2", goal: "Y2", enabled: false });
    expect(seq?.steps).toEqual([{ afterHours: 5, instruction: "b" }]);
  });

  it("list() trae todas, listEnabled() solo las activas", async () => {
    await repo.create({ name: "Activa", goal: "g", steps: [{ afterHours: 1, instruction: "a" }] });
    const idApagada = await repo.create({ name: "Apagada", goal: "g", steps: [{ afterHours: 1, instruction: "a" }] });
    await repo.update(idApagada, { name: "Apagada", goal: "g", steps: [{ afterHours: 1, instruction: "a" }], enabled: false });

    expect(await repo.list()).toHaveLength(2);
    const enabled = await repo.listEnabled();
    expect(enabled).toHaveLength(1);
    expect(enabled[0].name).toBe("Activa");
  });

  it("remove() la borra", async () => {
    const id = await repo.create({ name: "X", goal: "Y", steps: [{ afterHours: 1, instruction: "a" }] });
    await repo.remove(id);
    expect(await repo.getById(id)).toBeNull();
  });

  it("un bot no ve las secuencias de otro", async () => {
    const otroBot = await createSecondTestBot(db);
    await new NurtureSequencesRepo(db, otroBot).create({ name: "Ajena", goal: "g", steps: [{ afterHours: 1, instruction: "a" }] });
    expect(await repo.list()).toHaveLength(0);
  });
});
