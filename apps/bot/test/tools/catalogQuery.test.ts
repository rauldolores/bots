import { describe, it, expect, vi } from "vitest";

const CATALOG = [
  { name: "Concha", price: 25, description: "Pan dulce clásico" },
  { name: "Pan de muerto", price: 45, description: "Solo en temporada" },
];

vi.mock("../../src/db/bots", () => ({
  BotsRepo: class {
    constructor(_db: unknown) {}
    async getById(_id: string) {
      return { config: { catalog: CATALOG } };
    }
  },
}));

import { catalogQueryTool } from "../../src/tools/catalogQuery";

const BOT_ID = "00000000-0000-0000-0000-000000000001";

describe("catalogQueryTool", () => {
  it("returns matching products by fuzzy name", async () => {
    const tool = catalogQueryTool({} as any, BOT_ID);
    const result = (await tool.execute!({ query: "concha" }, {} as any)) as {
      matches: { name: string; price: number; description?: string; sku?: string }[];
    };
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].name).toBe("Concha");
  });

  it("returns empty matches when nothing matches", async () => {
    const tool = catalogQueryTool({} as any, BOT_ID);
    const result = (await tool.execute!({ query: "xyzabc" }, {} as any)) as {
      matches: { name: string; price: number; description?: string; sku?: string }[];
    };
    expect(result.matches).toHaveLength(0);
  });
});
