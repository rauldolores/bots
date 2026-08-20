# Multi-tenant, multi-bot y KontrolIA Auth

Estado: **F1, F2 y F3 desplegados. F4 parcial (Telegram), sin desplegar.** · 2026-08-18

Hoy Nodia Agents es **un despliegue = un bot**. Este documento define cómo pasa
a ser **una organización = muchos bots**, con el login centralizado del
ecosistema KontrolIA.

## Por qué es un cambio grande

No es agregar una columna. El bot no "tiene" configuración: **es** su
configuración, y esa vive fuera de la base.

| Pieza | Hoy | Tiene que ser |
|---|---|---|
| Las 20 tablas del bot | sin columna de tenant ni de bot | `organization_id` + `bot_id` |
| Identidad (`BOT_NAME`, `BUSINESS_NAME`, `BOT_NICHE`…) | variables de entorno | filas en `bots` |
| Negocio, servicios, horarios | `member/config.local.ts`, un **archivo de código** | datos por bot |
| Credenciales de canal | un `TELEGRAM_BOT_TOKEN` por despliegue | por bot, cifradas |
| Llave de IA | variable de entorno | por organización |
| Ruteo del webhook | `/webhooks/telegram` **es** el bot | tiene que deducir cuál |
| Panel | Basic Auth, una contraseña | sesión de KontrolIA Auth + rol |

**Multi-tenant y multi-bot son el MISMO cambio.** Si cada bot pertenece a una
organización, el `organization_id` viaja con el `bot_id`. Separarlos obligaría a
migrar el modelo de datos dos veces.

## Decisiones tomadas

| # | Decisión | Por qué |
|---|---|---|
| M1 | **Multi-tenant y multi-bot se hacen juntos** | Son el mismo cambio de modelo; separarlos migra dos veces |
| M2 | **Credenciales de canal cifradas con Supabase Vault** | Con multi-tenant, una fuga deja de ser riesgo propio y pasa a ser el de los clientes. Verificado: Vault guarda cifrado, lee descifrado y borra |
| M3 | **La llave de IA es de cada organización** | Mantiene la promesa del producto (no absorbes el consumo ajeno) y evita construir medición, topes y corte por consumo |
| M4 | **Auth con `@kontrolia/auth` (server), OAuth escrito a mano en Hono** | `@kontrolia/react` y `@kontrolia/next` son de Next.js; esto es Hono con HTML de servidor |
| M5 | **Un webhook por bot: `/webhooks/<canal>/<botId>`** | Es lo único que funciona sin ambigüedad con N bots por canal. Cada bot registra su propia URL en BotFather/Meta |
| M6 | **`conversations.id` deja de componerse a mano (`"canal:usuario"`) y pasa a ser un UUID aleatorio, como el resto de las tablas** | El id compuesto era único GLOBALMENTE por (channel, channel_user_id). Con más de un bot, dos clientes con el mismo id de canal en bots distintos colisionaban en la MISMA fila — el segundo heredaba la conversación del primero. Cambiar solo el esquema de unicidad no alcanza porque `id` es PRIMARY KEY (única global por definición); hacía falta soltar el id compuesto. Ninguna fila existente cambia de valor — es un cambio de esquema, no una migración de datos |
| M7 | **El `conversation_key` del agente (agent_state / pending_messages / agent_jobs) SÍ lleva el bot_id por delante: `"<botId>:<canal>:<usuario>"`** | Es la llave del pipeline de buffer/turno, se calcula ANTES de tocar la base (en el webhook, antes de que exista la conversación) — tiene que ser determinista sin round-trip. Las filas en vuelo al momento del despliegue quedan huérfanas (aceptable: son colas de segundos a minutos, nunca historial) |
| M8 | **Transición sin `bot_id` resuelto: `resolveBotId()` exige que la tabla `bots` tenga EXACTAMENTE una fila** | Hasta F4 (webhooks por bot) no hay de dónde más sacar el bot_id en el webhook ni en el panel. Con 0 o 2+ filas, falla fuerte — adivinar mezclaría datos entre organizaciones, que es el riesgo que F2 existe para cerrar. Se retira solo cuando F4 rutee por URL |
| M9 | **Los topes globales (follow-up diario, plantillas diarias, presupuesto mensual, umbral del watchdog) se vuelven por-bot cuando se les agregue el filtro, no antes** | Agregar `bot_id` a una consulta de agregación cambia su significado de "límite del despliegue" a "límite del bot" — es un cambio de comportamiento, no solo de aislamiento. Se decide junto con esa consulta en F2.3, no de golpe |
| M10 | **`admin_emails` y `magic_links` no se tocan en F2** | Auditoría de F2.1: ninguna ruta del código las lee ni las escribe hoy — son remanente del diseño de magic-link previo al Basic Auth actual. F5 decide si las reemplaza KontrolIA Auth o se eliminan |

### Lo que NO se decidió aquí

El repo es público y su README vende *"self-hosted, tu infraestructura, tu
llave, sin mensualidades de SaaS"*. Multi-tenant con login centralizado es
justo lo contrario. Puede convivir (el Starter open source sigue mono-tenant y
la SaaS es otra cosa), pero **es una decisión de producto pendiente**, no un
detalle técnico. Ver F5.

## Lo que ya está verificado

- `kontrolia_auth` (15 tablas: `organizations`, `memberships`, `roles`,
  `permissions`, `applications`…) **vive en la misma base** que el bot. No hay
  que federar nada: es un JOIN.
- `@kontrolia/auth` v2.1.0 existe en npm y es agnóstico de framework.
- Supabase Vault está activo y probado de punta a punta.

## Modelo destino

```sql
-- La tabla nueva que lo ordena todo. organization_id apunta a
-- kontrolia_auth.organizations (misma base, sin FK dura para no acoplar el
-- despliegue del bot al del auth-server).
bots(
  id uuid pk,
  organization_id uuid not null,   -- el tenant
  slug text not null,              -- único dentro de la organización
  name, business_name, language, niche, tier,
  buffer_seconds int,
  config jsonb,                    -- lo que hoy es member/config.local.ts
  paused boolean,
  created_at bigint
)
unique (organization_id, slug)

bot_channels(                      -- un canal conectado de un bot
  id uuid pk,
  bot_id uuid not null,
  channel text not null,           -- telegram | whatsapp | meta | twilio…
  external_id text,                -- phone_number_id, page_id… para ruteo
  secret_ref uuid,                 -- -> vault.secrets (NUNCA el token en claro)
  verify_token_ref uuid,
  enabled boolean
)
unique (bot_id, channel)

org_ai_keys(                       -- M3: la llave es de la organización
  organization_id uuid pk,
  provider text,                   -- anthropic | openai | xai
  key_ref uuid                     -- -> vault.secrets
)
```

Y las 20 tablas existentes ganan `bot_id` (y `organization_id` donde la consulta
lo necesite sin JOIN). El `conversation_key` del agente pasa de
`"<canal>:<usuario>"` a `"<botId>:<canal>:<usuario>"`.

## Fases

Cada fase queda **verde y desplegable** antes de la siguiente.

- **F1 — Modelo de datos.** Tablas `bots`, `bot_channels`, `org_ai_keys`;
  `bot_id` en las 20 tablas; el bot actual migrado a una fila (organización de
  Kontrolia). Sin cambio de comportamiento todavía: el código sigue leyendo env,
  pero ya escribe con `bot_id`. **Riesgo: bajo.**

- **F2 — Alcance por bot en las consultas.** Al auditar F1 apareció más
  superficie de la prevista (33 archivos construyen un repo o `Db` directo;
  varias claves únicas no contempladas en el modelo original — ver M6-M10).
  Se parte en sub-fases, cada una verde antes de la siguiente:

  - **F2.1 — El pipeline de conversación (✅ hecho, este commit).**
    `ConversationsRepo` exige `bot_id` en el constructor y filtra cada
    consulta; `conversations.id` pasa a ser UUID (M6); `conversation_key`
    lleva el bot_id por delante (M7); `resolveBotId()` transicional (M8).
    Esto cierra el riesgo dominante: dos bots con un cliente que comparte
    canal + id de usuario ya no pueden compartir conversación, mensajes,
    estado del agente ni ticket. Tests de aislamiento en
    `test/db/conversations.test.ts`. Quedan sin tocar (documentado, no
    fuga real todavía porque el despliegue sigue siendo un solo bot):
    `pickFollowupCandidates` (consulta global en `followup/run.ts`), y
    todo lo de F2.2/F2.3.

  - **F2.2 — Las tablas de datos por-fila (✅ hecho, este commit).** `leads`,
    `tickets`, `settings`, `conversation_insights`, `kb_docs`, `kb_chunks`
    (pgvector), `improvement_suggestions`, `customer_facts`. Cada repo exige
    `bot_id` en el constructor y filtra cada consulta; `settings` pasa de
    PK `key` a único `(bot_id, key)` — cubre también las llaves con
    namespace propio (`map:<canal>`, `send:<canal>:tipo`,
    `learn:<canal>:<kind>`) sin tocar a quien las usa; `kb_chunks` pasa de
    PK `id` a único `(bot_id, id)` porque los ids de los fixtures
    (scripts/kb-fixtures.json) son estáticos — dos bots con el mismo niche
    pack reindexando el mismo fixture se pisaban. Tests de aislamiento en
    `test/db/leads.test.ts`, `tickets.test.ts`, `settings.test.ts` y
    `test/kb/docs.test.ts` (el más crítico: `PgVectorStore.query` no debe
    devolver contenido de otro bot — es lo que `searchKb` expone al cliente
    en cada turno). `admin_emails` y `magic_links` no se tocaron: sin
    llamador vivo (decisión M10). `tracked_links`, `keyword_hits`,
    `conv_labels` no se tocaron: sin escritor vivo — el `bot_id` que ya
    tienen de F1 alcanza para cuando exista uno.

  - **F2.3 — Caps globales, panel y crons (✅ hecho, este commit).**
    `followup_sends`/`template_sends` (cap diario de follow-up y de
    plantillas HSM) filtran y escriben `bot_id` — decisión M9 aplicada (el
    cap pasa de "del despliegue" a "del bot"); `campaignHistory` ya no
    mezcla estadísticas de dos bots con el mismo `campaign_key`;
    `segments.ts` (la lista de destinatarios real de una campaña) exige
    `bot_id`. `MessagesRepo` ahora escribe y filtra `bot_id` (antes solo
    tenía la columna, sin llenar, desde F1) — eso desbloqueó filtrar
    `pickPending`/`detectLessons` (crons de insights y flywheel),
    el umbral del watchdog y `monthIaCostUsd`/el desglose de costos del
    panel, que antes agregaban mensajes de TODOS los bots del despliegue.

    Pendiente, explícitamente fuera de esta fase: las rutas del panel con
    `:id` de la URL ya heredan el filtro porque construyen sus repos con
    `resolveBotId()` — hoy iguala al único bot del despliegue, así que no
    hay fuga real, pero tampoco hay verificación de que el `:id` pertenezca
    a quien está logueado; eso lo cierra la sesión de F5. Un puñado de
    subconsultas de conteo en `admin/views/conversations.ts` y
    `overview.ts` (contador de tickets abiertos por conversación, contador
    global de conversaciones) quedaron sin auditar línea por línea — son
    números de tablero, no contenido de conversación, y de bajo riesgo real
    porque ya pasan por conversaciones/repos bot-scoped en el 90% de los
    casos.

  - **F2.3 — Los que la leen: panel, tools, crons.** Las ~20 rutas del panel
    con `:id` de la URL sin verificación de dueño (IDOR: `/leads/:id/status`,
    `/tickets/:id/resolve`, `/kb/:id/edit|delete`, `/mejoras/:id/*`…), los
    crons de fondo (`followup`, `flywheel`, `watchdog`, `campaigns`,
    `insights/analyzer`) que hoy asumen un solo bot por despliegue, y los
    topes globales que se vuelven por-bot (M9). **Riesgo: alto** (mismo
    motivo, superficie más amplia).

  Los tests de aislamiento explícito (uno por tabla, como el de F2.1)
  acompañan cada sub-fase, no se dejan para el final.

- **F3 — Configuración desde la base (✅ hecho salvo Vault).**
  `member/config.local.ts` se retiró — `businessConfig` (horarios, servicios,
  ubicación, pagos, teléfono, campos libres) y `catalog` viven en
  `bots.config` (jsonb, ya existía desde F1). `scripts/bot:config`
  (`npm run bot:config -- '{...}'`) reemplaza "editar el archivo y
  redesplegar" — el cambio aplica al instante, igual que ya aplicaba el
  override del panel (`settings.business_context`) por encima.

  Identidad y tier también se movieron: `isPro()` se retiró — `isProTier(tier)`
  toma el tier YA RESUELTO por quien llama (`BotsRepo.getById`), no un `Env`
  ni un `Db` — así quien olvide resolverlo tiene un error de tipos, no un bot
  que se comporta distinto según de dónde lo llamaron. Tocó ~15 sitios
  (middleware Pro del panel, `buildTools`, `runner.ts`, `handoffHuman.ts`,
  `layout()` del sidebar). `getNiche()` y `systemPromptFromEnv()` pasaron por
  el mismo cambio: reciben el dato ya resuelto (`bots.niche`,
  `{name, businessName, language}`), no un `Env`. La fila real de producción
  se corrigió ANTES de este commit (tenía los valores placeholder del
  backfill de F1 — `tier: 'free'` cuando el bot real es Pro — confirmado con
  el dueño antes de escribir, porque Vercel marca esas env vars como
  "Sensitive" y no se pueden leer por CLI).

  El skill `/configurar-mi-chatbot` (Fase 2) y las referencias sueltas en
  `/exportar`, `/reporte` y troubleshooting quedaron actualizadas.

  Pendiente, explícitamente fuera de esta fase: las credenciales de canal
  (Vault) — siguen siendo secrets del entorno, no `bot_channels.secret_ref`.
  Es la única pieza que le falta a F3. **Riesgo: medio** (solo por Vault;
  identidad/tier/negocio ya no tienen riesgo de fuga entre bots).

- **F4 — Webhooks por bot + Vault (parcial, este commit).** Resultó ser el
  mismo trabajo que Vault (decisión M2): un token en Vault en vez de en el
  entorno no aporta nada mientras solo haya un bot — la razón de Vault es
  justo que un SEGUNDO bot no comparta el token del primero.

  Hecho, para Telegram, ManyChat y Twilio: `src/db/vault.ts`
  (create/read/update/delete sobre `vault.secrets` / `vault.decrypted_secrets`
  — probado a mano contra la Supabase de producción: crear, leer, actualizar
  y borrar un secreto de prueba, los cuatro verificados uno por uno antes de
  escribir nada permanente); `BotChannelsRepo` (con `config` jsonb desde
  este commit — Twilio necesita `TWILIO_ACCOUNT_SID` y `TWILIO_WA_FROM`
  además del token, y ninguno de los dos es un secreto, así que no van en
  Vault); `resolveChannelEnv()` (Vault + config pisan al entorno SOLO si el
  canal ya está conectado — si no, cae al de siempre, cero cambio de
  comportamiento); `/webhooks/telegram/:botId`, `/webhooks/manychat/:botId`
  y `/webhooks/twilio/:botId` nuevas, con las rutas viejas intactas al lado
  (decisión M5). `npm run channel:connect -- <canal> <token>` conecta un
  canal (el secreto; SID/número de Twilio se cargan aparte con
  `BotChannelsRepo.upsert({config})`, todavía sin script propio).

  Bug encontrado al construir Twilio: `runTurn()` armaba la respuesta con el
  `env` crudo de la corrida del tick, no con el resuelto por bot — un bot
  con Telegram o Twilio propio hubiera PENSADO con su identidad pero
  RESPONDIDO con el token de otro. Igual en `notifyOwner` (el aviso al
  dueño por handoff). Los tres puntos de envío (ingesta, turno, aviso al
  dueño) ya resuelven su propio env por canal — antes solo lo hacía la
  ingesta.

  **Nada de esto se activó en producción**: conectar un canal no cambia a
  qué URL le pega el proveedor — eso exige el registro externo (`setWebhook`
  de Telegram, el flujo de ManyChat, la consola de Twilio), fuera de esta
  fase a propósito.

  Limitación encontrada: el Postgres de CI (`pgvector/pgvector`, no la
  Supabase completa) no tiene el esquema `vault` — por eso `vault.ts` no
  tiene test automatizado contra CI, solo la verificación manual de arriba;
  lo que SÍ corre en CI es la lógica de `resolveChannelEnv` con `readSecret`
  mockeado.

  **Meta y WhatsApp quedan fuera — son un problema distinto, no el mismo
  patrón repetido:** Meta te da UN webhook por app, no uno por página — un
  solo POST puede traer eventos de páginas de VARIOS bots a la vez. `:botId`
  en la URL no alcanza; hay que resolver el bot **por evento**, con
  `BotChannelsRepo.getByExternalId()` (ya existe, pensado para esto) usando
  el `page_id`/`phone_number_id` de cada mensaje. Y falta decidir algo de
  producto primero: ¿cada bot trae su propia app de Meta (su propio
  `app_secret`), o todos comparten la app de la plataforma? Eso cambia cómo
  se verifica la firma.

  **Riesgo: medio** (Telegram/ManyChat/Twilio sin fuga; Meta/WhatsApp
  siguen exactamente como estaban — env compartido, sin cambio).

- **F5 — Auth y panel multi-bot (parcial, este commit: el login).**
  KontrolIA Auth reemplaza el Basic Auth; selector de organización y de bot;
  permisos por rol. Aquí se resuelve la pregunta de producto (¿el Starter
  open source conserva un modo mono-tenant?).

  Hecho: `/admin/login` redirige a `auth-server` (que ES el GoTrue del
  proyecto de Supabase compartido — no hay un servidor OAuth aparte) con
  Authorization Code + PKCE; `/admin/oauth/callback` intercambia el código y
  deja una sesión en cookie (`nodia_kontrolia_session`, httpOnly); el guard
  del panel verifica el `access_token` contra el JWKS del proyecto
  (`@kontrolia/auth/server`) y refresca solo cuando expira. Basic Auth NO
  desapareció: sigue viva como salida de emergencia (header
  `Authorization: Basic` o `?basic=1`), y si `SUPABASE_URL` /
  `SUPABASE_ANON_KEY` / `OAUTH_CLIENT_ID` no están las tres configuradas, el
  panel se comporta exactamente como antes — es opt-in, no disruptivo.
  Verificado con un login real contra `auth.kontrolia.io` en local.

  Encontrado al registrar el cliente OAuth: si `redirect_uris` se guarda con
  las URIs separadas por espacio (como quedó al registrarlo "a mano" la
  primera vez), GoTrue las rechaza con `invalid_redirect_uri` — hay que
  guardarlas una por línea desde panel.kontrolia.io → Clientes OAuth.

  Pendiente, explícitamente fuera de este commit: el selector de
  organización/bot en el panel (hoy `resolveBotId()` sigue fallando duro con
  2+ bots — este login es el prerequisito, no el selector en sí) y permisos
  por rol. **Riesgo: medio** (login sin fuga verificado; selector y roles
  siguen sin construir).

- **F6 — Instalación.** El skill de configuración, el CLI y la documentación
  pasan de "configura tu despliegue" a "crea un bot en tu organización".

## Riesgos conocidos

- **Aislamiento entre organizaciones (IDOR).** Es el riesgo dominante y no
  admite "casi": una consulta sin `bot_id` filtra datos de un cliente a otro.
  Mitigación: el `bot_id` es obligatorio en el constructor de cada repo, y hay
  tests de aislamiento por tabla.
- **El bot en producción ya tiene datos** (conversaciones, un lead). F1 lo migra
  a una fila; hasta entonces no se toca su comportamiento.
- **Vault añade una llave que administrar.** Si se pierde, los tokens de canal
  de todos los clientes son irrecuperables (hay que volver a capturarlos).
