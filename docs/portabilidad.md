# Portabilidad: de Cloudflare-only a multiplataforma + Supabase

Estado: **completado** (salvo el CLI) · 2026-08-16

KontrolIA Bots nació atado a Cloudflare: D1 para datos, Vectorize para búsqueda, R2 para
archivos, Workers AI para embeddings y voz, y un Durable Object para el agente.
Este documento define cómo se desata, sin perder el comportamiento que hace que
el bot se sienta bien.

## Objetivo

- **Desplegable en**: local (Node/Docker), Vercel, Netlify, Cloudflare Workers,
  y cualquier servidor con Node (Railway, Render, Fly, VPS).
- **Base de datos**: Supabase (local o cloud). Postgres es la única base.
- Un solo código, sin forks por plataforma.

## Decisiones tomadas

| # | Decisión | Por qué |
|---|---|---|
| D1 | **Cola en Postgres + tick** reemplaza al Durable Object | Es lo único que funciona igual en serverless y en servidor de larga vida |
| D2 | **Cloudflare sigue soportado**, como un destino más | No romper lo ya publicado; obliga a que el driver de Postgres corra en workerd |
| D3 | **Proveedor de IA intercambiable** para embeddings y voz | Coherente con `src/llm/provider.ts`, que ya hace justo eso para el cerebro |
| D4 | Los timestamps siguen siendo **epoch ms en `bigint`** | El código TS ya piensa en ms; migrar a `timestamptz` tocaría los 61 call sites sin ganar nada |
| D5 | La traducción `?` → `$1..$n` vive **dentro de la clase `Db`** | Evita reescribir el SQL de 31 archivos; el sello ya existe y está limpio |
| D6 | **R2 se elimina** | `CATALOG` estaba declarado en `env.ts` y no se usaba en ninguna parte |
| D7 | En desarrollo, KontrolIA Bots vive en el **esquema `bots`** de la Supabase local que ya existía en la máquina | Esa base es compartida con el ecosistema KontrolIA (tiene `public.kontrolia_migrations`); un esquema propio evita mezclar 16 tablas con lo ajeno |

## Entorno de desarrollo

La Supabase local de este repo (`supabase/config.toml`, `project_id = "bots"`)
existe y tiene los puertos corridos a la serie `544xx` para no chocar, pero está
**detenida**: se usa la que ya corría en la máquina.

```
postgresql://postgres:postgres@127.0.0.1:54322/postgres?options=-c%20search_path%3Dbots%2Cpublic
```

pgvector 0.8.2 quedó habilitado ahí. `public` sigue teniendo solo lo de KontrolIA.
(El `,public` del search_path no es opcional: ahí vive el tipo `vector`.)

## Arquitectura final

Cómo quedó de verdad (el plan original preveía un `runtime/types.ts` y un
`queue/enqueue.ts` que al final no hicieron falta: el contrato de plataforma se
redujo a construir el driver, y el encolado vive dentro del propio `runner`):

```
src/
  app.ts            ← la app Hono: webhooks, /admin, /cron/*. SIN nada de plataforma
  runtime/          ← la capa que absorbe las diferencias de plataforma
    env.ts          ← construye el driver desde DATABASE_URL y lo cachea por URL
    node.ts         ← servidor de larga vida (local, Docker, Railway…)
    cloudflare.ts   ← el `main` de wrangler.toml
    vercel.ts · netlify.ts
  queue/
    jobs.ts         ← la cola: debounce, lease, buffer, reenvío
    tick.ts         ← procesa lo vencido
    wake.ts         ← despierta el tick donde hay waitUntil
  agent/
    runner.ts       ← ingestMessage() + runTurn(): lo que era SupportAgent
    state.ts        ← lo que era setState()
  ai/embeddings.ts · media/transcribe.ts   ← proveedores intercambiables
  vector/pgvector.ts · vector/store.ts     ← lo que era Vectorize
  db/client.ts · db/driver.ts · db/drivers/postgresJs.ts · db/placeholders.ts
```

Fuera de `src/`: `api/index.ts` (Vercel), `netlify/functions/` (Netlify),
`supabase/migrations/` (el esquema), `scripts/db-apply.ts` y `scripts/db-query.ts`.

Hono no se tocó: ya era portable a los cuatro destinos.

### El agente sin Durable Object

El DO daba tres cosas gratis. Postgres las da, pero hay que pedirlas:

1. **Serialización por conversación** → `FOR UPDATE SKIP LOCKED` sobre la fila del
   job. Dos ticks en paralelo nunca agarran la misma conversación.
2. **Estado persistente** (`setState`) → tabla `agent_state`, una fila por conversación.
3. **El temporizador de 15s** → columna `run_after`. Cada mensaje nuevo la empuja
   hacia adelante, que es exactamente el debounce que hacía `setAlarm()`.

```sql
-- al llegar un mensaje
insert into pending_messages (conversation_key, payload) values ($1, $2);
insert into agent_jobs (conversation_key, run_after)
     values ($1, now() + make_interval(secs => $3))
on conflict (conversation_key)
  do update set run_after = excluded.run_after;   -- ← el debounce
```

**Quién despierta el tick**, por plataforma:

| Destino | Disparo principal | Respaldo |
|---|---|---|
| Node / Docker | `setInterval` cada 2s | — |
| Cloudflare | `ctx.waitUntil` tras el ingest | cron de 1 min |
| Vercel | `waitUntil` tras el ingest | Vercel Cron (1 min) |
| Netlify | Scheduled Function | — |

Donde hay `waitUntil` la latencia queda igual que hoy (15s exactos); el cron es
solo la red de seguridad para lo que se haya caído. **Este es el punto del plan
con más riesgo de portarse distinto en cada plataforma.**

## Fases

- **F0 — Spike del driver. ✅ Verde.** `postgres.js` habla con Supabase desde Node
  y desde workerd (con `nodejs_compat`), usando el mismo driver
  (`src/db/drivers/postgresJs.ts`). Se verificó lo que podía romperse en silencio:
  la traducción `?`→`$n` sobre literales en español, `rowsAffected = 0` en
  `ON CONFLICT DO NOTHING` (el claim atómico de `src/followup/run.ts:147`), y que
  los `bigint` vuelven como `number` y no como `BigInt`. Reproducible con
  `scripts/spike-postgres.ts` y `scripts/spike-worker/`.
- **F1 — Base de datos. ✅ Verde.** `Db` corre sobre Postgres, `env.DB` pasó a ser
  el driver (los 61 `new Db(env.DB)` quedaron intactos), `schema.sql` se tradujo a
  `supabase/migrations/`, y `npm run db:apply` aplica migraciones contra cualquier
  Postgres. **451 tests en verde**, 35 archivos migrados de Miniflare a Postgres
  real (`test/helpers/pgSetup.ts`); la suite bajó de ~125s a ~13s.

  Diferencias de dialecto que había que encontrar y no eran obvias:

  | Qué | SQLite hacía | Postgres exige |
  |---|---|---|
  | Timestamps epoch ms | `INTEGER` de 64 bits | `BIGINT` — el `INTEGER` de 32 bits se desborda |
  | `AS channelUserId` | respeta mayúsculas | pasa a minúsculas sin comillas → el código leía `undefined` |
  | `AVG()` | devuelve número | devuelve `numeric` → llega como string; hay que castear |
  | `SELECT DISTINCT` + `ORDER BY` | permitido | el `ORDER BY` debe estar en el SELECT |
  | `json_each` / `json_extract` | funciones propias | `jsonb_array_elements` / `->>` |
  | `strftime(…, 'unixepoch')` | siempre UTC | `EXTRACT` lee en la zona de la sesión → hay que fijar `AT TIME ZONE 'UTC'` |
  | `INSERT OR REPLACE/IGNORE` | sintaxis propia | `ON CONFLICT … DO UPDATE / DO NOTHING` |
- **F2 — Vectorial + IA. ✅ Verde.** Vectorize salió: la búsqueda vive en la misma
  Postgres (`kb_chunks` + índice HNSW coseno, `src/vector/pgvector.ts`). Embeddings
  y transcripción quedaron con proveedor intercambiable
  (`src/ai/embeddings.ts`, `src/media/transcribe.ts`): Workers AI en Cloudflare,
  OpenAI fuera. **468 tests en verde.**

  Lo que hubo que resolver:

  - **La dimensión es única a propósito.** pgvector fija la dimensión en la
    columna, así que dos proveedores con dimensiones distintas harían imposible
    el cambio en caliente. Ambos emiten **1024**: bge-m3 lo hace nativo y OpenAI
    acepta el parámetro `dimensions` para recortar. Un proveedor futuro que no
    pueda dar 1024 exige migrar la columna **y** reindexar.
  - **`public` tiene que ir en el `search_path`**, porque ahí vive el tipo
    `vector`. Sin él, `vector(1024)` no resuelve y la migración falla.
  - **OpenAI no promete el orden de los embeddings**: se reordenan por `index`.
    Sin eso, el texto 0 se quedaría con el vector del texto 2 — un error que no
    da excepción, solo respuestas malas.
  - Los tests que fingían Vectorize ahora verifican el efecto real en
    `kb_chunks`, que además detecta cosas que el mock no veía (por ejemplo, que
    al acortar un documento sus chunks viejos no queden huérfanos).
- **F3 — El agente. ✅ Verde.** El Durable Object ya no existe. En su lugar:
  `src/agent/runner.ts` (ingest + turno), `src/agent/state.ts`, `src/queue/jobs.ts`
  (cola y lease), `src/queue/tick.ts` y `src/queue/wake.ts`. Con él se fueron el
  paquete `agents`, el binding `AGENT` y `src/db/schema.sql`. **490 tests.**

  Cómo se sustituyó cada cosa que el DO regalaba:

  | Lo que daba el DO | Cómo se consigue ahora |
  |---|---|
  | Un actor por conversación | Lease sobre la fila de `agent_jobs` (`FOR UPDATE SKIP LOCKED`) |
  | `setState` | Tabla `agent_state`, una fila por conversación |
  | `setAlarm` (buffer de 15s) | `agent_jobs.run_after`, empujado por cada mensaje nuevo |
  | Buffer en memoria | Tabla `pending_messages` |

  Detalles que costaron pensarse:

  - **El buffer es tabla y no un JSON dentro del estado.** Sin la serialización
    del DO, dos webhooks simultáneos que leyeran-modificaran-escribieran el mismo
    JSON perderían un mensaje. Un INSERT no se pisa.
  - **`DELETE ... RETURNING` para vaciar el buffer**, no un SELECT y luego un
    DELETE: entre ambos podría llegar un mensaje y quedarse sin responder.
  - **El reloj es el de Postgres**, no el del proceso. En serverless conviven
    instancias con relojes distintos y un debounce de 15s se comportaría raro.
  - **El trabajo se cierra aunque el buffer venga vacío**, o reintentaría para
    siempre contra la nada.
  - `src/queue/wake.ts` conserva la latencia: donde hay `waitUntil` el turno
    corre a los 15s exactos, igual que antes. El cron es solo la red de seguridad.
- **F4 — Adaptadores. ✅ Verde.** `src/index.ts` se partió en `src/app.ts` (la app
  Hono, sin nada de plataforma) más un adaptador por destino en `src/runtime/`.
  **El bot ya arranca:** se levantó el servidor Node contra Supabase, se mandaron
  tres webhooks de Telegram seguidos y la cola hizo exactamente lo previsto —
  3 pendientes, **1 trabajo**, y al vencer el buffer un solo mensaje de usuario
  con los tres unidos. **532 tests.**

  | Destino | Arranque | Quién despierta la cola |
  |---|---|---|
  | Node / Docker | `npm start` | `setInterval` cada 2s |
  | Cloudflare | `npm run deploy:cf` | `waitUntil` + cron de 1 min |
  | Vercel | `api/index.ts` + `vercel.json` | `waitUntil` + Vercel Cron |
  | Netlify | `netlify/functions/` + `netlify.toml` | **solo** Scheduled Function |

  Dos defectos que solo aparecieron al correrlo de verdad, y que ningún test
  cubría:

  - **`date(created_at/1000,'unixepoch')`** seguía en tres vistas del panel. Mi
    barrido de dialecto buscó `datetime(` pero no `date(`. Pasó typecheck y los
    490 tests porque `routes.test.ts` usa un driver simulado y su SQL nunca se
    ejecuta. Ahora `test/admin/render-all.test.ts` renderiza las 16 vistas contra
    Postgres real — se verificó que falla si se reintroduce el error.
  - **Hono LANZA al leer `c.executionCtx` cuando no existe**, que es el caso en
    Node. El webhook devolvía 500 con el mensaje ya encolado, y un 500 hace que
    Telegram y Meta reintenten: el cliente habría recibido la respuesta
    duplicada. Cubierto en `test/webhooks.test.ts`.

  **Reintento de envío.** El turno guardaba el mensaje del asistente y DESPUÉS lo
  mandaba; si el canal fallaba (token vencido, rate limit), el reintento
  encontraba el buffer vacío y el cliente se quedaba esperando una respuesta que
  sí existía. Ahora la respuesta se aparta en `agent_jobs.pending_reply` antes de
  enviarla, y el reintento la reenvía sin volver a llamar al LLM ni duplicar el
  historial. Se limpia justo después del envío, así que la ventana para un
  duplicado es el instante entre mandar y marcar.
- **F5 — Instalación y documentación. ✅ Verde (salvo el CLI).** README, `CLAUDE.md`,
  `.env.example`, el skill `/configurar-mi-chatbot` (Fase 1 reescrita: elegir destino →
  Supabase → esquema), `/exportar`, `/reporte`, `troubleshooting.md` y `PRIVACY.md`.
  Nuevos: `docs/despliegue.md` (guía por destino) y `scripts/db-query.ts`, un consultor
  de **solo lectura** que reemplaza a `wrangler d1 execute` — rechaza cualquier cosa que
  no sea un `SELECT`, que es justo lo que esos dos skills prometen. `deploy-check` ahora
  exige `DATABASE_URL`. **535 tests.**

  **El CLI (`cli/`) queda fuera a propósito.** Sigue asumiendo Cloudflare de principio a
  fin, y tocarlo obliga a decidir antes sobre identidades publicadas que no son mías:
  el paquete npm `forjabot`, el dominio `app.forjabots.com`, el repo
  `github.com/santmun/forja`, las variables `FORJA_*` y la carpeta `~/.forja/`.
  Renombrarlas rompe instalaciones existentes en silencio.

## Deuda conocida que esto genera

- **El bot todavía no arranca en ningún destino.** F1 dejó `env.DB` esperando un
  driver, pero nadie se lo pasa aún — eso es F4. Los tests pasan porque arman el
  driver ellos mismos. Es un estado intermedio esperado, no un olvido.
- **Un turno que tarde más de 5 minutos (`AGENT_JOB_LEASE_MS`) puede tomarse dos
  veces.** El DO no tenía ese límite. Con el failover de proveedores el peor caso
  real ronda los 15s, así que hay margen de sobra — pero es un techo, no una
  garantía absoluta.
- **Cambiar de proveedor de embeddings obliga a reindexar el KB**: los vectores de
  bge-m3 y los de OpenAI no son comparables entre sí aunque midan lo mismo. El
  esquema no cambia, pero el contenido indexado hay que rehacerlo (`/admin/kb`,
  botón de reindexar).
- **Netlify responde más lento que los demás**: sin `waitUntil`, la cola solo
  avanza con la Scheduled Function, así que el bot contesta en el siguiente
  disparo en vez de a los 15s. Hay que decirlo en la documentación de instalación.
- **El CLI `cli/` sigue sin migrar**, por las identidades publicadas (ver F5).
- **`test/admin/routes.test.ts` sigue usando un driver simulado.** Ya no es un agujero
  —`render-all.test.ts` cubre el SQL real— pero conviene recordar que ese archivo prueba
  ruteo, no consultas.
