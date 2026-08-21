// Diagnóstico de la base: responde "¿puedo conectarme, y está lista?" sin
// imprimir jamás la cadena de conexión ni la contraseña.
//
// Es lo primero que conviene correr al instalar y lo primero que hay que mirar
// cuando el bot no responde. Comprueba, en orden, lo que de verdad falla en la
// práctica: credenciales, modo del pooler, esquema de destino, pgvector y si el
// esquema ya está aplicado.
//
// Uso:  npm run db:check

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL. Ponla en .env o en las variables de tu destino.");
  process.exit(1);
}

const u = new URL(url);
const puerto = u.port || "5432";
const searchPath = decodeURIComponent(new URLSearchParams(u.search).get("options") ?? "")
  .replace(/^-c\s*search_path\s*=\s*/, "")
  .trim();

console.log("Conexión");
console.log(`  host           ${u.hostname}`);
console.log(
  `  puerto         ${puerto}  ${
    puerto === "6543"
      ? "(pooler en modo transacción — lo correcto para serverless)"
      : puerto === "5432"
        ? "(conexión directa o pooler en modo sesión)"
        : ""
  }`,
);
console.log(`  search_path    ${searchPath || "(ninguno → se usará public)"}`);

const sql = postgres(url, { max: 1, prepare: puerto !== "6543", connect_timeout: 20, idle_timeout: 5 });
let problemas = 0;

function ok(m: string) { console.log(`  ok    ${m}`); }
function mal(m: string, arreglo?: string) {
  problemas++;
  console.log(`  FALLA ${m}${arreglo ? `\n        → ${arreglo}` : ""}`);
}

try {
  console.log("\nComprobaciones");
  const v = await sql`select version() as v, current_schema() as esquema`;
  ok(`conecta · ${String(v[0].v).split(",")[0]}`);
  ok(`esquema activo: ${v[0].esquema ?? "(ninguno)"}`);

  const ext = await sql`
    select extnamespace::regnamespace::text as esquema from pg_extension where extname = 'vector'`;
  if (ext.length) {
    ok(`pgvector instalado en el esquema "${ext[0].esquema}"`);
    // El tipo tiene que RESOLVER desde nuestro search_path, no solo existir.
    try {
      await sql`select '[1,2,3]'::vector`;
      ok("el tipo vector resuelve desde este search_path");
    } catch {
      mal(
        "pgvector existe pero NO resuelve desde este search_path",
        `agrega "${ext[0].esquema}" al search_path de tu DATABASE_URL`,
      );
    }
  } else {
    const disp = await sql`select 1 from pg_available_extensions where name = 'vector'`;
    mal(
      "pgvector no está instalado",
      disp.length
        ? "se instala solo al correr `npm run db:apply`"
        : "tu Postgres no lo trae; en Supabase actívalo en Database → Extensions",
    );
  }

  const tablas = await sql<{ n: number }[]>`
    select count(*)::int as n from information_schema.tables
     where table_schema = current_schema()`;
  if (tablas[0].n === 0) {
    mal("el esquema está vacío", "corre `npm run db:apply` para crear las tablas");
  } else {
    ok(`${tablas[0].n} tablas en el esquema activo`);
    const cola = await sql`
      select 1 from information_schema.tables
       where table_schema = current_schema() and table_name = 'agent_jobs'`;
    if (cola.length) ok("la cola del agente existe (agent_jobs)");
    else mal("falta agent_jobs", "corre `npm run db:apply`");
  }
} catch (e) {
  mal(`no se pudo conectar: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  await sql.end({ timeout: 5 }).catch(() => {});
}

console.log(problemas === 0 ? "\nLa base está lista." : `\n${problemas} cosa(s) por arreglar.`);
process.exit(problemas === 0 ? 0 : 1);
