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
      autoEnroll: false,
    });
    const seq = await repo.getById(id);
    expect(seq).toMatchObject({ name: "X2", goal: "Y2", enabled: false, auto_enroll: false });
    expect(seq?.steps).toEqual([{ afterHours: 5, instruction: "b" }]);
  });

  it("list() trae todas, listEnabled() solo las activas", async () => {
    await repo.create({ name: "Activa", goal: "g", steps: [{ afterHours: 1, instruction: "a" }] });
    const idApagada = await repo.create({ name: "Apagada", goal: "g", steps: [{ afterHours: 1, instruction: "a" }] });
    await repo.update(idApagada, { name: "Apagada", goal: "g", steps: [{ afterHours: 1, instruction: "a" }], enabled: false, autoEnroll: false });

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

// Asignar la secuencia a mano, lead por lead, era inviable en cuanto entran
// leads a diario. Una secuencia puede marcarse como la automática — y solo UNA,
// porque un lead vive en una sola secuencia a la vez (leads.sequence_id) y con
// dos marcadas cuál gana sería arbitrario.
describe("secuencia automática", () => {
  const paso = [{ afterHours: 1, instruction: "a" }];

  it("getAutoEnroll devuelve la marcada", async () => {
    await repo.create({ name: "Normal", goal: "g", steps: paso });
    await repo.create({ name: "Auto", goal: "g", steps: paso, autoEnroll: true });
    expect((await repo.getAutoEnroll())?.name).toBe("Auto");
  });

  it("sin ninguna marcada, devuelve null — el caso normal", async () => {
    await repo.create({ name: "Normal", goal: "g", steps: paso });
    expect(await repo.getAutoEnroll()).toBeNull();
  });

  it("marcar una SEGUNDA le quita la marca a la primera", async () => {
    await repo.create({ name: "Primera", goal: "g", steps: paso, autoEnroll: true });
    await repo.create({ name: "Segunda", goal: "g", steps: paso, autoEnroll: true });

    expect((await repo.getAutoEnroll())?.name).toBe("Segunda");
    const todas = await repo.list();
    expect(todas.filter((s) => s.auto_enroll)).toHaveLength(1);
  });

  it("y lo mismo al editar una existente", async () => {
    await repo.create({ name: "Primera", goal: "g", steps: paso, autoEnroll: true });
    const otra = await repo.create({ name: "Otra", goal: "g", steps: paso });
    await repo.update(otra, { name: "Otra", goal: "g", steps: paso, enabled: true, autoEnroll: true });

    expect((await repo.getAutoEnroll())?.name).toBe("Otra");
    expect((await repo.list()).filter((s) => s.auto_enroll)).toHaveLength(1);
  });

  it("una automática APAGADA no inscribe a nadie", async () => {
    // Marcarla automática y dejarla apagada es una contradicción; ante la duda,
    // no perseguir a nadie por accidente.
    const id = await repo.create({ name: "Auto", goal: "g", steps: paso, autoEnroll: true });
    await repo.update(id, { name: "Auto", goal: "g", steps: paso, enabled: false, autoEnroll: true });
    expect(await repo.getAutoEnroll()).toBeNull();
  });
});
