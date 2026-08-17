// Se ejecuta una vez por proceso de test (vitest `setupFiles`).
// Solo se encarga de no dejar basura: el esquema de pruebas se borra al final.
import { afterAll } from "vitest";
import { dropTestDb } from "./helpers/pgSetup";

afterAll(async () => {
  await dropTestDb();
});
