# Troubleshooting — Horizontes Bot (Pro)

Guía de problemas comunes y cómo resolverlos. Está ordenada por etapa:
**Setup** (preparación e instalación), **Deploy** (subir el bot a producción),
**Runtime** (el bot ya está vivo pero algo falla) y **base de conocimiento** (la base
de conocimiento del negocio).

Antes de buscar tu error abajo, lo más rápido casi siempre es correr el chequeo
automático, que detecta secrets faltantes, bindings sin crear y configuración
incompleta:

```bash
npm run deploy-check
```

Si algo falta, el comando te lo dice por nombre antes de intentar subir nada.

> Todos los comandos `npm` y `wrangler` se corren **dentro de la carpeta del
> proyecto** (donde está `package.json`). Si ves `command not found` para
> `wrangler`, usa `npx wrangler ...` en lugar de `wrangler ...`.

---

## El bot recibe el mensaje pero no responde

Es el síntoma más común tras instalar, y casi siempre es **la cola**, no el bot.

El bot no contesta en el momento: guarda el mensaje, espera `BUFFER_SECONDS` por si el
cliente sigue escribiendo, y responde en el siguiente "tick". Si el mensaje aparece en
`/admin/conversaciones` pero nunca llega respuesta, el tick no está corriendo.

| Destino | Qué revisar |
|---|---|
| Local / servidor | ¿El proceso sigue vivo? El tick corre dentro de `npm start` |
| Cloudflare | Que `wrangler.toml` tenga el cron `* * * * *` y el deploy sea reciente |
| Vercel | Que exista `TICK_TOKEN` y que los crons estén activos (requieren plan Pro) |

Para comprobarlo a mano:

```bash
npm run db:query -- "SELECT conversation_key, run_after, attempts, last_error FROM agent_jobs"
```

- **Sin filas** → el mensaje no se encoló: el problema está en el webhook del canal.
- **Con filas y `run_after` en el pasado** → la cola no se está procesando (ver tabla).
- **Con `last_error`** → ahí está la causa exacta.

---

## Setup

| Error | Causa | Cómo arreglarlo |
|---|---|---|
| `wrangler: command not found` | wrangler no está en el PATH | usa `npx wrangler ...`, o instala global con `npm install -g wrangler` |
| `wrangler login` no abre el navegador | terminal sin entorno gráfico | corre `WRANGLER_LOG=debug npx wrangler login` y copia/pega el URL en tu navegador a mano |
| Dependencias no instalan / `node_modules` corrupto | instalación a medias | borra `node_modules` y corre `npm install` de nuevo |
| `Falta DATABASE_URL` | el bot no sabe dónde está su base | pon la cadena de Supabase en `.env` (local) o en las variables de tu destino |
| `password authentication failed` | no se reemplazó `[YOUR-PASSWORD]` en la cadena | copia otra vez la cadena de Supabase y sustituye el marcador por la contraseña real del proyecto |
| `too many connections` | conexión directa en serverless | usa la cadena del **pooler** (puerto `6543`), no la directa (`5432`) |
| `relation "conversations" does not exist` | falta aplicar el esquema | corre `npm run db:apply` |
| `type "vector" does not exist` | pgvector no está habilitado o falta `public` en el search_path | corre `CREATE EXTENSION IF NOT EXISTS vector;` en el SQL Editor de Supabase |
| `npm run typecheck` marca errores tras editar `member/config.local.ts` | falta un campo o hay una coma/llave mal | revisa que `businessConfig` tenga `hours`, `services`, `location`, `paymentMethods`, `contactPhone` y `customFields`, y que `memberConfig` esté completo |

**Preparar la base (primera vez):** crea un proyecto en Supabase, copia su cadena de
conexión y aplica el esquema:

```bash
DATABASE_URL="<la cadena de Supabase>" npm run db:apply
```

> La columna de embeddings usa **1024 dimensiones**, y los dos proveedores emiten
> ese tamaño a propósito (bge-m3 lo hace nativo, OpenAI se recorta con su parámetro
> `dimensions`). Así se puede cambiar de proveedor sin migrar el esquema. No cambies
> ese número: hacerlo obliga a migrar la columna **y** reindexar todo.

---

## Deploy

El comando de despliegue es `npm run deploy`. Antes de subir nada corre un
chequeo (deploy-check) que valida que tengas los secrets requeridos y los
bindings creados. Si falta algo, se detiene y te dice qué.

| Error | Causa | Cómo arreglarlo |
|---|---|---|
| `Authentication error` al desplegar | wrangler perdió la sesión | corre `npx wrangler login` otra vez |
| deploy-check: `Missing secret ANTHROPIC_API_KEY` | falta la llave de Claude (obligatoria) | `npx wrangler secret put ANTHROPIC_API_KEY` |
| deploy-check: `Missing secret DASHBOARD_PASSWORD` | falta la contraseña del dashboard (obligatoria en Pro) | `npx wrangler secret put DASHBOARD_PASSWORD` |
| deploy-check: falta `DATABASE_URL` | el bot no tiene base | guarda la cadena de Supabase como variable/secreto del destino |
| El bot recibe pero no responde | la cola no avanza | ver la sección «El bot recibe el mensaje pero no responde», arriba |
| Despliega pero `/health` da 404 | router mal montado | revisa `src/app.ts` y corre `npm run typecheck` antes de volver a desplegar |
| Despliega pero `/admin` da 500 | falta `ANTHROPIC_API_KEY` u otro secret en runtime | corre `npx wrangler secret list` y agrega el que falte con `secret put` |
| Cambios en `member/` no se reflejan tras deploy | confusión de carpetas | `member/` es tu config y se respeta siempre; lo que se redeploya es `src/`. Si tocaste la KB, además corre el reindex (sección KB) |

**Secrets disponibles** (agrégalos con `npx wrangler secret put NOMBRE`):

- **Obligatorios:** `ANTHROPIC_API_KEY`, `DASHBOARD_PASSWORD`
- **Canales:** `TELEGRAM_BOT_TOKEN`, `MANYCHAT_API_KEY`
- **WhatsApp (Twilio):** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WA_FROM`, `TWILIO_HANDOFF_CONTENT_SID`
- **Agenda:** `CALCOM_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`
- **Avisos al dueño:** `OWNER_TELEGRAM_CHAT_ID` (Telegram DM), `RESEND_API_KEY` + `OWNER_EMAIL` (email), `OWNER_WA_NUMBER` (WhatsApp)

> Las **variables** (no secretas) como `BOT_NAME`, `BUSINESS_NAME`, `BOT_LANGUAGE`,
> `BOT_TIER`, `BUFFER_SECONDS` y `DASHBOARD_BASE_URL` van en `[vars]` de
> `wrangler.toml` (Cloudflare), en el panel de variables (Vercel) o en el
> `.env` (local).

---

## Runtime (el bot ya está vivo)

### Dashboard / acceso de administrador

| Síntoma | Causa | Cómo arreglarlo |
|---|---|---|
| Al entrar al dashboard pide usuario y contraseña | es lo normal: el dashboard usa **Basic Auth** | usuario: **`admin`** (siempre), contraseña: la que pusiste en `DASHBOARD_PASSWORD` |
| `401 Unauthorized` al entrar al dashboard | la contraseña no coincide con `DASHBOARD_PASSWORD`, o el secret no está seteado | confirma que el usuario sea exactamente `admin`; vuelve a setear con `npx wrangler secret put DASHBOARD_PASSWORD` y redeploya con `npm run deploy` |
| Olvidaste la contraseña del dashboard | no se puede "recuperar", solo reemplazar | corre `npx wrangler secret put DASHBOARD_PASSWORD` con una nueva, luego `npm run deploy` |
| El navegador recuerda una contraseña vieja y da 401 | credenciales cacheadas de Basic Auth | abre en ventana privada/incógnito o limpia las credenciales guardadas del sitio |

> El dashboard **no tiene** login por email ni "magic link". No existe `/login`
> ni `/logout`. El único acceso es Basic Auth con usuario `admin`. Si una guía
> menciona magic link o Resend para iniciar sesión, está desactualizada — Resend
> aquí solo sirve para los **avisos por email al dueño**.

### Mensajes y canales

| Síntoma | Causa | Cómo arreglarlo |
|---|---|---|
| El bot no responde en Telegram | el webhook no está configurado o apunta mal | corre el `setWebhook` de la guía de Telegram apuntando a `https://<tu-worker>.workers.dev/telegram` |
| Telegram: el webhook responde error | token mal o URL incorrecta | verifica con `getWebhookInfo`; revisa `TELEGRAM_BOT_TOKEN` y que la URL termine en `/telegram` |
| El bot tarda mucho en responder (>10s) | el buffer de mensajes está alto | baja `BUFFER_SECONDS` en `wrangler.toml` (ej. `5`) y redeploya |
| El bot agrupa varios mensajes en una sola respuesta | comportamiento esperado del buffer | si lo quieres más reactivo baja `BUFFER_SECONDS`; si quieres que junte más, súbelo |
| El bot responde en el idioma equivocado | `BOT_LANGUAGE` mal configurado | edita `BOT_LANGUAGE` en `wrangler.toml` y redeploya |
| `streamText failed: 401` / `invalid x-api-key` | la llave de Claude es inválida o expiró | renueva en console.anthropic.com y vuelve a poner `npx wrangler secret put ANTHROPIC_API_KEY` |
| El bot ignora notas de voz | falta transcripción o canal sin audio | la transcripción usa Whisper de Workers AI; confirma que el binding **AI** exista en `wrangler.toml` |
| El bot no "ve" imágenes | función Pro de visión no activa | la lectura de imágenes usa Haiku (solo Pro); confirma `BOT_TIER=pro` y que llegue la imagen del canal |

### Handoff / avisos al dueño

| Síntoma | Causa | Cómo arreglarlo |
|---|---|---|
| No llega el aviso cuando un cliente pide hablar con una persona | falta el canal de aviso configurado | configura al menos uno: Telegram DM (`OWNER_TELEGRAM_CHAT_ID`), email (`RESEND_API_KEY` + `OWNER_EMAIL`) o WhatsApp Pro (Twilio) |
| No sabes tu `OWNER_TELEGRAM_CHAT_ID` | nunca le diste `/start` a tu propio bot | abre tu bot en Telegram, mándale `/start`, y obtén tu `chat_id` (ej. con `getUpdates`); guárdalo con `npx wrangler secret put OWNER_TELEGRAM_CHAT_ID` |
| El aviso por WhatsApp no llega | falta la plantilla aprobada de Twilio | WhatsApp **solo** envía con una plantilla aprobada: setea `TWILIO_HANDOFF_CONTENT_SID` (Content Template SID) y `OWNER_WA_NUMBER`; **no** se manda texto libre |
| Twilio devuelve error al avisar por WhatsApp | credenciales o número mal | revisa `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WA_FROM` y `OWNER_WA_NUMBER` (formato internacional, ej. `+52...`) |
| El email de aviso no llega | falta o es inválida la llave de Resend | setea `RESEND_API_KEY` y `OWNER_EMAIL`; revisa spam la primera vez |
| El bot se quedó "pausado" en una conversación | alguien usó la pausa (handoff) | el bot pausa una conversación cuando entra un humano; se reactiva según la lógica de la herramienta `pauseBot` |

### Herramientas (tools) y agenda

| Síntoma | Causa | Cómo arreglarlo |
|---|---|---|
| `scheduleAppointment` no agenda | falta config de Cal.com / Google | setea `CALCOM_API_KEY` y, si usas Google, `GOOGLE_SERVICE_ACCOUNT_JSON` |
| `catalogQuery` no encuentra productos | el catálogo no está cargado | súbelo desde `/admin/kb` |
| `captureLead` no guarda nada | la base de datos no responde | confirma el binding **DB** y que el esquema esté aplicado (`npm run db:apply`) |

### Mantenimiento automático

| Síntoma | Causa | Cómo arreglarlo |
|---|---|---|
| Los mensajes viejos no se borran | el cron de limpieza no corre | el cron diario `0 3 * * *` purga mensajes con más de 90 días; verifica el bloque `[triggers]`/`crons` en `wrangler.toml` |

---

## Base de conocimiento del negocio

La KB son tus archivos `member/kb/*.md`. Cuando los editas, hay que volver a
indexarlos para que el bot use la info nueva.

| Síntoma | Causa | Cómo arreglarlo |
|---|---|---|
| El bot no conoce info del negocio (horarios, servicios, precios) | la KB no está indexada o cambió y no se reindexó | vuelve a indexar (ver abajo) |
| El bot responde con info vieja | editaste `member/kb/*.md` pero no reindexaste | reindexa después de cada cambio en la KB |
| La búsqueda en la base de conocimiento no devuelve nada | falta indexar | corre `npm run kb:reindex` y luego `POST /kb/reindex` con el `KB_REINDEX_TOKEN` |
| `dimension mismatch` al indexar | el índice se creó con dimensiones distintas | borra y recrea el índice con `--dimensions=1024` (embeddings BGE) |
| La búsqueda (`searchKb`) devuelve resultados raros o vacíos | poca info o documentos muy largos | divide los `.md` en secciones claras por tema y reindexa |
| `member/config.local.ts` cambió pero el bot no lo refleja | esa config se lee en runtime, no es KB | no requiere reindex; basta redeploy con `npm run deploy` (no toca tu carpeta `member/`) |

**Reindexar la KB** (corre esto cada vez que edites `member/kb/*.md`):

```bash
npm run kb:reindex
```

> Si la KB también dependía de cambios en el esquema de la base de datos, aplica
> primero `npm run db:apply` y luego `npm run kb:reindex`.

> La carpeta `member/` (tu config y tu KB) **nunca se sobrescribe** al
> actualizar el bot. Solo `src/` se reemplaza. Si actualizas con
> `/actualizar-mi-bot` y algo de tu negocio "desaparece", revisa que tus cambios
> estén dentro de `member/` y no en `src/`.

---

## Si nada de esto funciona

1. Corre `npm run typecheck` — atrapa errores antes de desplegar.
2. Corre `npm test` — confirma que la lógica base sigue sana.
3. Revisa los logs en vivo: `npx wrangler tail`.
4. Confirma tus secrets: `npx wrangler secret list`.
5. Vuelve a desplegar: `npm run deploy` (el deploy-check te dirá qué falta).

Si sigues atorado, copia el mensaje de error completo y el comando exacto que
corriste — eso es lo que se necesita para ayudarte rápido.
