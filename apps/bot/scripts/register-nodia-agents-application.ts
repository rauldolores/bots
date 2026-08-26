/**
 * Registro inicial de la aplicación "Nodia Agents" en KontrolIA Auth, con su
 * catálogo de permisos (ver src/admin/permissions.ts). Calco exacto del
 * script de referencia del ecosistema
 * (faqturia/apps/faqturia/scripts/register-facturacion-application.ts).
 *
 * Escribe DIRECTO contra el Postgres compartido de KontrolIA Auth — no el
 * DATABASE_URL de este bot. kontrolia_auth.applications/permissions no
 * tienen policy de insert para usuarios normales (ver
 * auth/packages/db/migrations/0010_rls_policies.sql), así que esto es el
 * camino de platform-admin, igual que las migraciones del propio auth-server.
 *
 * Se ejecuta UNA sola vez por instalación de KontrolIA Auth — es seguro
 * re-ejecutarlo (upsert por slug de la app y por key de cada permiso).
 *
 * Para agregar/actualizar permisos MÁS ADELANTE no se vuelve a correr este
 * script: se usa el endpoint de sync (POST {authServerUrl}/api/applications/sync)
 * una vez exista la API key de la aplicación (se genera desde panel.kontrolia.io
 * → Aplicaciones → Nodia Agents → API Keys, después de que al menos una
 * organización la habilite).
 *
 * Ejecutar con:
 *   KONTROLIA_AUTH_DATABASE_URL="postgresql://..." npx tsx scripts/register-nodia-agents-application.ts
 *
 * Después de correrlo, falta un paso MANUAL que este script no hace (vive
 * fuera de cualquier repo, en la consola web): en panel.kontrolia.io →
 * Aplicaciones → Nodia Agents, ligar el client_id de OAuth que ya existe
 * ("Clientes OAuth") a esta aplicación recién registrada — ver
 * docs/multitenancy.md (F5) y auth/packages/db/migrations/0036_application_oauth_client_link.sql.
 */
import { registerApplication } from "@kontrolia/db";
import { NODIA_AGENTS_APP_SLUG, NODIA_AGENTS_PERMISSIONS } from "../src/admin/permissions";

const connectionString = process.env.KONTROLIA_AUTH_DATABASE_URL;

if (!connectionString) {
  console.error(
    "❌ Falta KONTROLIA_AUTH_DATABASE_URL (connection string de Postgres de la instancia de KontrolIA Auth — el " +
      "mismo DATABASE_URL usado para correr sus migraciones, NO el de este bot).",
  );
  process.exit(1);
}

async function main() {
  const { applicationId, permissionKeys } = await registerApplication({
    connectionString: connectionString!,
    name: "Nodia Agents",
    slug: NODIA_AGENTS_APP_SLUG,
    environment: (process.env.NODE_ENV === "production" ? "production" : "development") as
      | "development"
      | "staging"
      | "production",
    permissions: NODIA_AGENTS_PERMISSIONS,
  });

  console.log("applicationId:", applicationId);
  console.log("permissionKeys:", permissionKeys);
  console.log(
    "\n✅ Aplicación registrada (o actualizada si ya existía). Siguiente paso — desde panel.kontrolia.io:\n" +
      "  1. Aplicaciones → Nodia Agents → ligar el client_id de OAuth que ya existe (\"Clientes OAuth\").\n" +
      "  2. Asignarte a ti mismo un rol con permisos de Nodia Agents en tu organización, antes de que el " +
      "gating del panel se despliegue — si no, Basic Auth (?basic=1) sigue siendo la salida de emergencia.",
  );
}

main().catch((err) => {
  console.error("❌ Error registrando la aplicación:", err);
  process.exit(1);
});
