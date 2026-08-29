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
      stopOnConversion: true,
    });
    const seq = await repo.getById(id);
    expect(seq).toMatchObject({ name: "X2", goal: "Y2", enabled: false, auto_enroll: false });
    expect(seq?.steps).toEqual([{ afterHours: 5, instruction: "b" }]);
  });

  it("list() trae todas, listEnabled() solo las activas", async () => {
    await repo.create({ name: "Activa", goal: "g", steps: [{ afterHours: 1, instruction: "a" }] });
    const idApagada = await repo.create({ name: "Apagada", goal: "g", steps: [{ afterHours: 1, instruction: "a" }] });
    await repo.update(idApagada, { name: "Apagada", goal: "g", steps: [{ afterHours: 1, instruction: "a" }], enabled: false, autoEnroll: false, stopOnConversion: true });

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
// leads a diario. Una o VARIAS secuencias pueden marcarse como automáticas: un
// lead puede estar en varios seguimientos a la vez, así que entra a todas.
describe("secuencias automáticas", () => {
  const paso = [{ afterHours: 1, instruction: "a" }];

  it("listAutoEnroll devuelve las marcadas", async () => {
    await repo.create({ name: "Normal", goal: "g", steps: paso });
    await repo.create({ name: "Auto", goal: "g", steps: paso, autoEnroll: true });
    expect((await repo.listAutoEnroll()).map((s) => s.name)).toEqual(["Auto"]);
  });

  it("sin ninguna marcada devuelve vacío — el caso normal", async () => {
    await repo.create({ name: "Normal", goal: "g", steps: paso });
    expect(await repo.listAutoEnroll()).toEqual([]);
  });

  it("pueden ser VARIAS a la vez, y ninguna le quita la marca a la otra", async () => {
    // Justo lo que se corrigió: al principio un índice único dejaba solo una,
    // pero eso venía de que un lead solo podía estar en un seguimiento. Ya no.
    await repo.create({ name: "Primera", goal: "g", steps: paso, autoEnroll: true });
    await repo.create({ name: "Segunda", goal: "g", steps: paso, autoEnroll: true });
    expect((await repo.listAutoEnroll()).map((s) => s.name)).toEqual(["Primera", "Segunda"]);
  });

  it("una automática APAGADA no inscribe a nadie", async () => {
    // Marcarla automática y dejarla apagada es una contradicción; ante la duda,
    // no perseguir a nadie por accidente.
    const id = await repo.create({ name: "Auto", goal: "g", steps: paso, autoEnroll: true });
    await repo.update(id, {
      name: "Auto", goal: "g", steps: paso,
      enabled: false, autoEnroll: true, stopOnConversion: true,
    });
    expect(await repo.listAutoEnroll()).toEqual([]);
  });
});

// Además de agotar sus pasos, una secuencia puede cortarse sola al convertir.
describe("salida por conversión", () => {
  const paso = [{ afterHours: 1, instruction: "a" }];

  it("viene encendida por default — es lo que hacía siempre", async () => {
    const id = await repo.create({ name: "S", goal: "g", steps: paso });
    expect((await repo.getById(id))?.stop_on_conversion).toBe(true);
  });

  it("se puede apagar para seguimientos que EMPIEZAN con la venta", async () => {
    const id = await repo.create({ name: "Onboarding", goal: "g", steps: paso, stopOnConversion: false });
    expect((await repo.getById(id))?.stop_on_conversion).toBe(false);
  });
});
