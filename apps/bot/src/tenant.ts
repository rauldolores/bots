// Resuelve a qué bot pertenece este turno. F2 de docs/multitenancy.md ya
// exige el bot_id en cada consulta, pero F4 (webhooks por bot) todavía no
// existe: hoy sigue siendo "un despliegue = un bot", así que no hay de dónde
// leer el bot_id salvo la tabla `bots` misma.
//
// Transicional a propósito: cuando F4 rutee /webhooks/<canal>/<botId>, este
// helper deja de usarse en el camino del webhook y sobrevive solo donde de
// verdad hace falta (crons de un solo bot, herramientas de migración).
//
// Con más de un bot y sin forma de saber cuál, se falla fuerte: adivinar
// mezclaría datos entre organizaciones, que es justo el riesgo que F2 existe
// para cerrar.
import type { Db } from "./db/client";

export async function resolveBotId(db: Db): Promise<string> {
  const rows = await db.all<{ id: string }>("SELECT id FROM bots", []);
  if (rows.length === 1) return rows[0].id;
  if (rows.length === 0) {
    throw new Error(
      "No hay ningún bot en la tabla `bots` — corre la migración de multi-tenant o revisa el backfill.",
    );
  }
  throw new Error(
    `Hay ${rows.length} bots y este despliegue todavía no sabe rutear por bot (eso llega en F4) — no se puede adivinar cuál usar.`,
  );
}
