# Desplegar KontrolIA Bots

El bot corre en cinco sitios distintos con el mismo código. Lo que cambia es quién
despierta la cola del agente, y eso afecta **cuánto tarda en responder**.

## Antes que nada: la base de datos

Todos los destinos necesitan lo mismo — una Supabase y su cadena de conexión.

1. Crea un proyecto en [supabase.com](https://supabase.com) (el plan gratis alcanza).
2. Copia la cadena de **Project Settings → Database → Connection string**.
   - **En serverless (Vercel, Netlify, Cloudflare) usa el pooler**, el del puerto
     `6543`. Las funciones efímeras abren y cierran conexiones sin parar y una conexión
     directa agota el límite del proyecto. El código detecta el `:6543` y desactiva las
     sentencias preparadas, que ese modo no admite.
   - En un servidor de larga vida (Node, Docker) la conexión directa (`5432`) va bien.
3. Aplica el esquema:

```bash
DATABASE_URL="postgresql://…" npm run db:apply
```

Es idempotente: llevar la cuenta de lo aplicado es cosa suya, así que puedes correrlo
en cada actualización sin miedo.

## Variables

| Variable | Obligatoria | Para qué |
|---|---|---|
| `DATABASE_URL` | sí | Tu Supabase |
| `ANTHROPIC_API_KEY` *(u `OPENAI_API_KEY` / `XAI_API_KEY`)* | sí | El cerebro |
| `DASHBOARD_PASSWORD` | sí | Entrar a `/admin` (usuario: `admin`) |
| `BUSINESS_NAME`, `BOT_NAME`, `BOT_LANGUAGE` | sí | Identidad del bot |
| `BUFFER_SECONDS` | no (15) | Cuánto espera antes de responder |
| `OPENAI_API_KEY` | fuera de Cloudflare | Embeddings y notas de voz |
| `TICK_TOKEN` | Vercel y Netlify | Protege `/cron/*` |
| `KB_REINDEX_TOKEN` | sí | Protege `/kb/reindex` |
| `TELEGRAM_BOT_TOKEN`, `WHATSAPP_*`, `META_*`… | por canal | Ver `/admin/conexiones` |

Fuera de Cloudflare hace falta `OPENAI_API_KEY` **aunque el cerebro sea Claude o Grok**:
es lo que calcula los embeddings de la base de conocimiento y transcribe las notas de
voz. En Cloudflare eso lo cubre Workers AI sin llave aparte.

---

## Local o Docker (lo más simple)

```bash
npm install
DATABASE_URL="postgresql://…" npm start
```

El panel queda en `http://localhost:8787/admin`.

El proceso lleva sus propios temporizadores: revisa la cola **cada 2 segundos** y corre
los trabajos periódicos cada hora. No necesita cron externo ni `TICK_TOKEN`.

Sirve igual para Railway, Render, Fly o un VPS: cualquier sitio donde el proceso siga
vivo. El comando de arranque es `npm start` y el puerto sale de `PORT`.

## Cloudflare Workers

```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put DASHBOARD_PASSWORD
npm run deploy:cf
```

Ventaja propia: **Workers AI** cubre embeddings y voz sin llave de OpenAI. Responde a
los 15s exactos gracias a `waitUntil`, y `wrangler.toml` ya trae dos crons — uno por
minuto como red de seguridad de la cola y otro a las 3am para los trabajos nocturnos.

## Vercel

1. Importa el repo en Vercel.
2. Pon las variables en **Settings → Environment Variables**, incluido `TICK_TOKEN`
   (invéntate una cadena larga).
3. Despliega. `vercel.json` ya declara los dos crons.

Vercel Cron manda el token en la cabecera `Authorization`, y `/cron/*` lo acepta tanto
así como por `X-Tick-Token`. Responde a los 15s exactos, igual que Cloudflare.

> Los crons de Vercel requieren plan Pro. En el plan gratis el bot igual responde por
> `waitUntil`; lo que pierdes es la red de seguridad si una instancia muere a media
> respuesta.

## Netlify

1. Conecta el repo.
2. Pon las variables, incluido `TICK_TOKEN`.
3. Despliega. `netlify.toml` declara las funciones programadas.

**Este destino responde más lento y conviene saberlo antes de elegirlo.** Netlify no
ofrece `waitUntil`: la función muere en cuanto contesta el webhook, así que la cola solo
avanza cuando salta la función programada. En la práctica el bot contesta **en el
siguiente disparo** (hasta ~1 minuto) en vez de a los 15 segundos. Si la conversación
fluida importa, elige otro destino.

---

## Cuál elegir

| Si… | Destino |
|---|---|
| Quieres probarlo en tu máquina | **Local** |
| Quieres lo más barato y rápido, sin servidor | **Cloudflare** |
| Ya vives en Vercel | **Vercel** |
| Quieres control total o correr otras cosas al lado | **Docker / VPS** |
| Ya vives en Netlify | **Netlify**, sabiendo lo de la latencia |

## Comprobar que quedó bien

```bash
curl https://<tu-bot>/health                       # -> ok
curl -u admin:<tu-password> https://<tu-bot>/admin # -> el panel
```

Y manda un mensaje real por tu canal. Si el bot no contesta, mira `/admin/conversaciones`:
si el mensaje aparece pero no hay respuesta, el problema está en la cola (revisa que el
cron esté corriendo); si no aparece, el problema está en el webhook del canal.
