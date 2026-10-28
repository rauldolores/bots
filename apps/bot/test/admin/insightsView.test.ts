// La pantalla de Insights: lo que el analizador concluyó, con la estructura
// del resto del panel (hero, métricas, tarjetas) y los estados como punto +
// palabra en vez de emoji.
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { InsightsRepo } from "../../src/db/insights";
import { renderInsights } from "../../src/admin/views/insights";
import type { Env } from "../../src/env";

let db: Db;
let env: Env;

beforeEach(async () => {
  db = await createTestDb();
  env = { DB: db.driver } as unknown as Env;
});

describe("renderInsights", () => {
  it("sin análisis: hero, métricas en cero y estados vacíos, con un solo h1", async () => {
    const html = await renderInsights(env, TEST_BOT_ID);
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain("Análisis");
    expect(html).toContain('action="/admin/insights/analyze"');
    expect(html).toContain("Radar de conocimiento");
    expect(html).toContain("Sin huecos detectados");
    expect(html).toContain("Aún no hay conversaciones analizadas");
  });

  it("con un análisis: el sentimiento y la resolución salen como palabra, el hueco en el radar", async () => {
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("telegram", "u1", "Laura <b>Méndez</b>");
    await new InsightsRepo(db, TEST_BOT_ID).upsert({
      conversationId: conv.id,
      sentiment: "frustrated",
      resolution: "unresolved",
      botScore: 3,
      topics: ["pagos"],
      summary: "Preguntó por meses sin intereses.",
      missedKb: "¿Aceptan meses sin intereses?",
      saleOpportunity: true,
    });
    const html = await renderInsights(env, TEST_BOT_ID, "1");
    expect(html).toContain("Análisis completado");
    expect(html).toContain("Frustrado");
    expect(html).toContain("Sin resolver");
    expect(html).not.toContain("😕");
    expect(html).toContain("¿Aceptan meses sin intereses?");
    expect(html).toContain("Laura &lt;b&gt;Méndez&lt;/b&gt;");
  });
});
