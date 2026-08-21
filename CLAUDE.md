# Nodia Agents — monorepo

Este repo agrupa varias apps independientes bajo `apps/`. Cada una es su
propio proyecto (su propio `package.json`, se instala/despliega por separado)
— no hay npm workspaces ni build compartido entre ellas.

- **`apps/bot/`** — el chatbot: la app Hono (webhook + `/admin` + crons),
  se despliega en local/Docker/Cloudflare/Vercel, guarda todo en Supabase.
  Ver [`apps/bot/CLAUDE.md`](apps/bot/CLAUDE.md) para trabajar aquí.
- **`apps/web/`** — el sitio público (Next.js). Ver su propio README/CLAUDE.md
  si existe.

Si estás resolviendo algo de UN bot en particular, entra a `apps/bot/` — ahí
vive el detalle completo (arquitectura, comandos, reglas de negocio).
