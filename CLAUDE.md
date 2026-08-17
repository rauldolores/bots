# KontrolIA Bots — instrucciones para Claude Code

Chatbot de soporte con IA, open source. Una app **Hono** (Vercel AI SDK) con panel en
`/admin`, que se despliega en **local, Docker, Cloudflare, Vercel o Netlify** y guarda
todo en **Supabase**. Quien lo clona probablemente **no sabe programar** — tú corres
todo por él.

## Arquitectura en 30 segundos

```
webhook → ingestMessage()  →  buffer en Postgres (pending_messages)
                              + turno programado (agent_jobs.run_after)
                                        ↓  15s después
                              tick() → runTurn() → LLM → respuesta al canal
```

El bot **no responde en el webhook**. Espera unos segundos (`BUFFER_SECONDS`) por si el
cliente sigue escribiendo, y contesta una sola vez a todo junto. Ese retraso es
deliberado y es lo que hace que no se sienta robot: si tocas la cola, no lo rompas.

- `src/app.ts` — la app Hono: webhooks, `/admin`, `/cron/*`. **Sin nada de plataforma.**
- `src/runtime/` — un adaptador por destino (`node`, `cloudflare`, `vercel`, `netlify`).
  Es quien construye el driver de Postgres y lo mete en `env.DB`.
- `src/agent/runner.ts` — `ingestMessage()` (guardas + buffer) y `runTurn()` (el turno).
- `src/queue/` — `jobs.ts` (cola y lease), `tick.ts` (procesa vencidos), `wake.ts`.
- `src/db/client.ts` — **la única puerta a la base**. Mantenla así.
- `src/vector/pgvector.ts` — búsqueda de la base de conocimiento.
- `src/ai/embeddings.ts` — embeddings intercambiables (Workers AI / OpenAI).
- `src/llm/provider.ts` — el cerebro (Anthropic / OpenAI / xAI, con llave del dueño).
- `src/admin/` — el panel. `src/tools/` — las herramientas del agente.
- `src/niches/` — "niche pack" por giro: re-etiqueta el panel y aporta el playbook.
- `supabase/migrations/` — el esquema. `skill/` — asistentes para el usuario.

Cómo se llegó hasta aquí y por qué cada decisión: [`docs/portabilidad.md`](docs/portabilidad.md).
Cómo desplegar en cada destino: [`docs/despliegue.md`](docs/despliegue.md).

## Al desarrollar

- **Todo el SQL pasa por `Db`** (`src/db/client.ts`), con `?` posicional — la traducción
  a `$1..$n` ocurre dentro. No metas `driver.query()` suelto por ahí.
- **Postgres, no SQLite.** Al escribir SQL nuevo: los alias en camelCase van
  **entre comillas** (`AS "channelUserId"`), `AVG()` necesita `::float8`, y las fechas
  se calculan con `AT TIME ZONE 'UTC'` (si no, el resultado cambia según el servidor).
- **Los timestamps son epoch en milisegundos, en `BIGINT`.** Nunca `INTEGER`: se desborda.
- **Nada de comillas invertidas dentro de comentarios SQL** — el SQL vive en template
  literals y las cierra.
- **Un test que use un driver simulado no prueba el SQL.** Si tocas una consulta,
  cúbrela contra la base real (mira `test/helpers/pgSetup.ts`).
- Antes de dar algo por terminado: `npm test` y `npm run typecheck`, ambos limpios.

Los tests necesitan un Postgres. Por defecto usan `TEST_DATABASE_URL`, o la Supabase
local en `127.0.0.1:54322`.

## Comandos

```bash
npm install
npm run db:apply       # aplica supabase/migrations/ a DATABASE_URL
npm start              # servidor Node (local/Docker)
npm run dev            # igual, recargando al guardar
npm test               # 534 tests
npm run typecheck
npm run deploy:cf      # desplegar a Cloudflare
```

## Instalación (si no existe `.bot-state.json`)

Sigue el skill **`/configurar-mi-chatbot`** (en `skill/`; si no está registrado, abre el
archivo directo). Son 4 fases y el orden no se negocia:

1. **TU PLATAFORMA** — Supabase + el destino que elija, la API key del cerebro y
   `DASHBOARD_PASSWORD`, y desplegar. Al terminar, su panel está vivo en `/admin`.
2. **TU CHATBOT** — negocio, tareas, idioma y base de conocimiento.
3. **TUS CONEXIONES** — canales uno por uno (Telegram, WhatsApp, Meta…) desde `/admin`.
4. **PRUEBA FINAL** — mensaje real + resumen sin badges rojos.

Antes de la Fase 1: verifica que exista **Node ≥18** (npm viene incluido) y explícale
cómo funciona y cuánto cuesta — vive en SU infraestructura, y el cerebro es su propia
llave de IA (~$1–2/mes).

## Reglas

- **Habla en español sencillo (LATAM)**, una pregunta a la vez.
- **Nunca pegues tokens ni llaves en el chat.** Van como variables de entorno o secretos
  de la plataforma (`wrangler secret put`, el panel de Vercel/Netlify, o un `.env` local).
- **No toques `member/`** más allá de lo que indican los skills: ahí viven los datos del
  negocio del usuario y se respetan en cada actualización.
- **No despliegues ni hagas commit sin que el usuario lo confirme.**

## Skills disponibles

- `/configurar-mi-chatbot` — instalación de cero (las 4 fases).
- `/reporte` — informe mensual de valor para el cliente.
- `/exportar` — exporta leads y conversaciones (CSV/JSON).
- `/actualizar-mi-bot` — trae la última versión conservando tu config.

## ¿Quieres más? (KontrolIA Bots+)

Este repo es el **Starter** genérico, sirve para cualquier negocio. Los **14 giros con
panel a la medida**, los comandos que trabajan por ti (mantenimiento, campaña, Modo
Agencia para revender…) y la comunidad viven en **KontrolIA Bots+** → https://horizontesia.com
