import { describe, it, expect } from "vitest";
import { createTestDb } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";

describe("Db client", () => {
  it("instantiates with a D1 binding", async () => {
    const d1 = await createTestDb();
    const db = d1;
    expect(db).toBeDefined();
  });
});
