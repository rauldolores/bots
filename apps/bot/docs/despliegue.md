# Desplegar Nodia Agents

El bot corre en varios sitios distintos con el mismo código. Lo que cambia es quién
despierta la cola del agente, y eso afecta **cuánto tarda en responder**.

## Antes que nada: la base de datos

Todos los destinos necesitan lo mismo — una Supabase y su cadena de conexión.

1. Crea un proyecto en [supabase.com](https://supabase.com) (el plan gratis alcanza).
2. Copia la cadena de **Project Settings → Database → Connection string**.
   - **Si el bot tiene su propio esquema** (lo normal cuando la base es compartida
     con otras apps), usa el **Session pooler** (puerto `5432`). Es el único modo que
     respeta el `search_path`: el **Transaction pooler** (`6543`) rechaza el parámetro
     `options`, y aunque no lo hiciera, en modo transacción cada consulta puede caer
     en una conexión distinta, así que un `SET search_path` tampoco sobreviviría. Con
     `6543` **todo aterrizaría en `public`**, junto a las tablas de las otras apps.
   - Si el bot tiene la base para él solo y vive en `public`, el Transaction pooler
     (`6543`) va bien y escala mejor. El código detecta el `:6543` y desactiva las
     sentencias preparadas, que ese modo no admite.
   - En un servidor de larga vida (Node, Docker) la conexión directa (`5432`) también sirve.

   Para aislar el bot en su propio esquema, añade el `search_path` a la cadena:

   ```
   ...pooler.supabase.com:5432/postgres?options=-c%20search_path%3Dbots%2Cextensions%2Cpublic
   ```

   `extensions` va ahí porque es donde Supabase instala pgvector; sin él, `vector(1024)`
   no resuelve. Comprueba que quedó bien con `npm run db:check`.
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
| `TICK_TOKEN` | Vercel | Protege `/cron/*` |
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

---

## Cuál elegir

| Si… | Destino |
|---|---|
| Quieres probarlo en tu máquina | **Local** |
| Quieres lo más barato y rápido, sin servidor | **Cloudflare** |
| Ya vives en Vercel | **Vercel** |
| Quieres control total o correr otras cosas al lado | **Docker / VPS** |


## Comprobar que quedó bien

```bash
curl https://<tu-bot>/health                       # -> ok
curl -u admin:<tu-password> https://<tu-bot>/admin # -> el panel
```

Y manda un mensaje real por tu canal. Si el bot no contesta, mira `/admin/conversaciones`:
si el mensaje aparece pero no hay respuesta, el problema está en la cola (revisa que el
cron esté corriendo); si no aparece, el problema está en el webhook del canal.

---

## Por qué no Netlify

Se evaluó y se descartó. Netlify no ofrece `waitUntil`: su función muere en cuanto
responde el webhook, así que la cola solo puede avanzar cuando salta la función
programada — el bot contestaría hasta un minuto tarde. Para un bot de atención al
cliente eso no es aceptable, y mantener un destino que damos por malo solo confunde a
quien instala.
