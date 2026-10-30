// Comprueba que el bundle de Vercel CARGA en Node, igual que lo carga Vercel al
// arrancar la función. Corre después de `npm run build` (ver `build:check`).
//
// Por qué existe: las pruebas importan `src/` con vitest y nunca tocan
// `dist/vercel.js`, así que un bundle que Node rechaza pasa CI en verde. Eso
// tumbó producción ~15 h el 2026-10-28: fflate (ESM) importaba `createRequire`
// y el banner de esbuild declaraba el mismo nombre → `SyntaxError: Identifier
// 'createRequire' has already been declared` y 500 en todas las rutas.
//
// Se importa `api/index.js` (lo que Vercel ejecuta), no `dist/` directo, para
// cubrir también el re-export. `prepareEnv` exige DATABASE_URL al cargar; la
// de abajo es de mentira y nunca se conecta: importar no abre la base.

process.env.DATABASE_URL ??= "postgresql://check:check@127.0.0.1:1/check";

try {
  const mod = await import("../api/index.js");
  if (typeof mod.fetch !== "function") {
    console.error("✗ api/index.js cargó pero no exporta `fetch`: Vercel no tendría handler.");
    process.exit(1);
  }
  console.log("✓ El bundle de Vercel carga y exporta `fetch`.");
} catch (err) {
  console.error("✗ El bundle de Vercel NO carga — en producción sería 500 en todas las rutas:\n");
  console.error(err);
  process.exit(1);
}
