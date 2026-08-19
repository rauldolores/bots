# Multi-tenant, multi-bot y KontrolIA Auth

Estado: **plan aprobado, sin implementar** · 2026-08-18

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

- **F2 — Alcance por bot en las consultas.** Las ~38 consultas se filtran por
  `bot_id`. Aquí vive el riesgo de **fuga entre tenants**: una consulta sin
  filtrar deja que una organización lea datos de otra. Cada repo lleva el
  `bot_id` en el constructor para que olvidarlo sea un error de tipos, no un
  descuido. Tests que prueban el aislamiento explícitamente. **Riesgo: alto.**

- **F3 — Configuración desde la base.** `resolveAgentConfig` deja de leer env y
  lee la fila del bot; `member/config.local.ts` se convierte en datos. Las
  credenciales de canal salen de Vault. **Riesgo: medio.**

- **F4 — Webhooks por bot.** `/webhooks/<canal>/<botId>`, con las rutas viejas
  respondiendo mientras el bot actual no re-registre su URL. **Riesgo: medio.**

- **F5 — Auth y panel multi-bot.** KontrolIA Auth reemplaza el Basic Auth;
  selector de organización y de bot; permisos por rol. Aquí se resuelve la
  pregunta de producto (¿el Starter open source conserva un modo mono-tenant?).
  **Riesgo: medio.**

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
