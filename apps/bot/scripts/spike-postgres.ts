// Spike de F0 (ver docs/portabilidad.md): ¿postgres.js sirve como driver único?
//
// No basta con "conecta". Lo que hay que probar es lo que el código de Nodia Agents
// realmente depende y que podría romperse en silencio al salir de D1:
//
//   1. La traducción `?` → `$n` sobre SQL real del repo.
//   2. `rowsAffected` en un ON CONFLICT DO NOTHING — es el claim atómico que
//      impide mandar dos veces el mismo seguimiento (src/followup/run.ts:147).
//   3. Los timestamps `bigint` vuelven como `number`, no como BigInt.
//
// Uso: DATABASE_URL=postgresql://… npx tsx scripts/spike-postgres.ts

import { createPostgresDriver } from "../src/db/drivers/postgresJs";
import { toPositional } from "../src/db/placeholders";

const URL_ = process.env.DATABASE_URL;
if (!URL_) {
  console.error("Falta DATABASE_URL");
  process.exit(1);
}

const driver = createPostgresDriver({ url: URL_ });
const q = (text: string, params: unknown[] = []) =>
  driver.query(toPositional(text), params);

let failures = 0;
function check(name: string, ok: boolean, detail: unknown = "") {
  console.log(`${ok ? "  ok  " : " FALLA"}  ${name}${detail ? `  → ${detail}` : ""}`);
  if (!ok) failures++;
}

try {
  const version = await q("SELECT version() AS v");
  check("conecta", true, String(version.rows[0].v).slice(0, 40));

  await q("DROP TABLE IF EXISTS spike_followup_sends");
  await q(`CREATE TABLE spike_followup_sends (
    conversation_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    sent_at BIGINT NOT NULL,
    PRIMARY KEY (conversation_id, kind)
  )`);

  // 1. Placeholders traducidos sobre SQL con literal en español.
  const ins = await q(
    "INSERT INTO spike_followup_sends (conversation_id, kind, sent_at) VALUES (?, ?, ?)",
    ["conv-1", "recordatorio", Date.now()],
  );
  check("INSERT con ? traducido", ins.rowsAffected === 1, `rowsAffected=${ins.rowsAffected}`);

  // 2. El claim atómico: el segundo intento NO debe afectar filas.
  const claim = await q(
    `INSERT INTO spike_followup_sends (conversation_id, kind, sent_at)
     VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
    ["conv-1", "recordatorio", Date.now()],
  );
  check(
    "ON CONFLICT DO NOTHING devuelve rowsAffected=0 (claim atómico)",
    claim.rowsAffected === 0,
    `rowsAffected=${claim.rowsAffected}`,
  );

  // 3. Los bigint vuelven como number, no BigInt.
  const row = await q("SELECT sent_at FROM spike_followup_sends WHERE conversation_id = ?", [
    "conv-1",
  ]);
  const sentAt = row.rows[0].sent_at;
  check("BIGINT vuelve como number", typeof sentAt === "number", `typeof=${typeof sentAt}`);

  // 4. Un literal con `?` en español sobrevive el viaje completo.
  const texto = await q("SELECT ? AS t, '¿Confirmas tu cita?' AS literal", ["hola"]);
  check(
    "literal español intacto",
    texto.rows[0].literal === "¿Confirmas tu cita?" && texto.rows[0].t === "hola",
    String(texto.rows[0].literal),
  );

  // 5. pgvector disponible (lo necesita F2).
  try {
    await q("CREATE EXTENSION IF NOT EXISTS vector");
    const ext = await q("SELECT extversion AS v FROM pg_extension WHERE extname = 'vector'");
    check("pgvector disponible", ext.rows.length > 0, `v${ext.rows[0]?.v}`);
  } catch (e) {
    check("pgvector disponible", false, String(e).slice(0, 80));
  }

  await q("DROP TABLE IF EXISTS spike_followup_sends");
} catch (e) {
  check("spike completo", false, String(e).slice(0, 200));
} finally {
  await driver.close();
}

console.log(failures === 0 ? "\nSPIKE VERDE" : `\nSPIKE ROJO (${failures} fallas)`);
process.exit(failures === 0 ? 0 : 1);
