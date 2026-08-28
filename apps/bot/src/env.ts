import type { Ai } from "@cloudflare/workers-types";
import type { SqlDriver } from "./db/driver";

export interface Env {
  // Bindings
  //
  // El Durable Object desapareció (F3): el buffer, el estado y el temporizador
  // del agente viven en Postgres (agent_jobs / agent_state / pending_messages),
  // que es lo único que funciona igual en las cuatro plataformas.
  // Ya no es un binding de D1 sino el driver de Postgres que arma el adaptador
  // de cada plataforma. Los 61 `new Db(env.DB)` del código siguen igual.
  DB: SqlDriver;
  // Cadena de conexión de Supabase. La lee el adaptador de la plataforma para
  // construir `DB`; el resto del código no la toca. Ver src/runtime/env.ts.
  DATABASE_URL?: string;
  // La búsqueda vectorial dejó de ser un binding: vive en la misma Postgres
  // (tabla kb_chunks). Se construye con `new PgVectorStore(new Db(env.DB))`.
  // R2 (CATALOG) se eliminó: estaba declarado y no se usaba en ninguna parte.
  //
  // Workers AI es OPCIONAL: solo existe corriendo en Cloudflare. Fuera de ahí,
  // los embeddings y la transcripción salen por OpenAI. Ver src/ai/embeddings.ts.
  AI?: Ai;

  // Proveedor de embeddings: "workers-ai" | "openai" | "auto" (default).
  EMBEDDING_PROVIDER?: string;
  OPENAI_EMBEDDING_MODEL?: string;
  OPENAI_TRANSCRIBE_MODEL?: string;

  // Vars (member-set)
  BOT_NAME: string;
  PEER_BOTS?: string; // JSON [{name,url}] — otras instancias para el selector de proyectos
  WA_DAILY_TEMPLATE_CAP?: string; // tope diario de plantillas HSM (default 250 — tier 1 de Meta)
  BUSINESS_NAME: string;
  BOT_LANGUAGE: string;
  BOT_TIER: "free" | "pro";
  // Nicho del bot (restaurante, inmobiliaria…). Selecciona el "niche pack" que
  // re-etiqueta el dashboard, aporta el playbook del giro y sus columnas.
  // Ausente/desconocido → pack genérico (comportamiento actual). Ver src/niches/.
  BOT_NICHE?: string;
  BUFFER_SECONDS: string;
  DASHBOARD_BASE_URL: string;
  // Solo para despliegues divididos (p.ej. Voice en Fly.io, el resto en
  // Vercel): dónde vive el panel REAL para los links que se le mandan al
  // dueño (ticket por correo, etc.) cuando este proceso no es el que sirve
  // /admin. Vacío = usa DASHBOARD_BASE_URL, como siempre.
  ADMIN_BASE_URL?: string;

  // Secrets (member-set via wrangler secret put)
  // Qué proveedor/modelo de IA usa el bot se decide SOLO desde /admin/config
  // (SettingsRepo, ver src/llm/provider.ts) — estas llaves son nada más el
  // secreto de cada proveedor; no hay variable de entorno que fuerce
  // proveedor o modelo por fuera del panel.
  ANTHROPIC_API_KEY: string;
  OPENAI_API_KEY?: string;  // proveedor LLM alterno (ver src/llm/provider.ts)
  RESEND_API_KEY?: string;
  // Canal "email" — SOLO para responder (sendReply); nunca se leen de
  // despliegue, resolveChannelEnv() los mete aquí desde settings.email_*
  // (/admin/config → Correo saliente) para el bot de cada turno. Distinto
  // de RESEND_API_KEY de arriba: ese es la key de NOTIFICACIÓN AL DUEÑO
  // (handoffHuman.ts), de despliegue — esto es la key con la que el bot le
  // contesta AL CLIENTE, por bot y elegida por el dueño en el panel.
  EMAIL_OUTBOUND_PROVIDER?: "resend" | "mailgun";
  EMAIL_OUTBOUND_API_KEY?: string;
  EMAIL_OUTBOUND_DOMAIN?: string;
  EMAIL_FROM_ADDRESS?: string;
  EMAIL_FROM_NAME?: string;
  TELEGRAM_BOT_TOKEN?: string;
  MANYCHAT_API_KEY?: string;
  MANYCHAT_CONTENT_TYPE?: "instagram" | "whatsapp" | "telegram" | "messenger"; // ManyChat channel for sendContent; defaults to "instagram"
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_WA_FROM?: string;
  TWILIO_HANDOFF_CONTENT_SID?: string;  // approved WhatsApp template for owner handoff DM
  // Canal Voice (F7 fase 2): número de Twilio Voice-capable que recibe llamadas.
  // Usa las MISMAS credenciales de cuenta (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN)
  // que WhatsApp — Twilio firma todos sus webhooks con el mismo Auth Token sin
  // importar el producto.
  TWILIO_VOICE_NUMBER?: string;
  // Canal Voice (F7 fase 3): OpenAI Realtime — el modelo de audio en tiempo
  // real. La API key NO vive aquí (se resuelve por bot desde /admin/config →
  // Voz, con fallback a OPENAI_API_KEY — ver channels/voice/openaiKey.ts);
  // este var es solo el override del modelo concreto si hace falta cambiarlo
  // sin tocar código. Vacío = "gpt-realtime-2.1-mini" (realtimeClient.ts).
  OPENAI_REALTIME_MODEL?: string;
  // Override del endpoint de Realtime — para pruebas (un servidor falso
  // local). Vacío = wss://api.openai.com/v1/realtime (uso normal).
  OPENAI_REALTIME_URL?: string;
  // Duración máxima de una llamada antes de cerrarla sola (protección contra
  // una sesión de Realtime atorada). Vacío = 30 minutos.
  VOICE_MAX_CALL_DURATION_MS?: string;
  // F7 fase 6: manejo de silencios largos. Cuánto silencio del cliente (sin
  // respuesta activa) antes de sondear si sigue en la línea, y cuánto en
  // total antes de colgar si no contesta. Vacío = 15s / 45s.
  VOICE_SILENCE_NUDGE_MS?: string;
  VOICE_SILENCE_HANGUP_MS?: string;
  /** Cada cuánto se revisa (setInterval) — para pruebas. Vacío = 5s. */
  VOICE_SILENCE_CHECK_INTERVAL_MS?: string;
  // Meta oficial (Facebook Messenger + Instagram DMs, sin ManyChat).
  META_PAGE_ACCESS_TOKEN?: string;  // Messenger / IG ligado a Página (graph.facebook.com)
  INSTAGRAM_ACCESS_TOKEN?: string;  // Instagram API con Instagram Login, token IGAA… (graph.instagram.com)
  META_VERIFY_TOKEN?: string;       // string que tú eliges; valida el handshake GET del webhook
  META_APP_SECRET?: string;
  // "manychat" = los DMs de Instagram entran SOLO por ManyChat (el webhook
  // oficial de Meta los ignora para no procesarlos doble).
  IG_DM_SOURCE?: string;
  // "off" = canal oficial de IG apagado por completo (DMs). El bot de IG vive
  // solo en ManyChat.
  IG_OFFICIAL?: string;         // App Secret de Facebook; firma los webhooks de Messenger
  INSTAGRAM_APP_SECRET?: string;    // App Secret del producto Instagram (IG Login); firma los webhooks de IG
  // WhatsApp OFICIAL (Cloud API de Meta, sin BSP/Twilio). Mismo ecosistema Graph
  // que Meta; el número corre en la cuenta del miembro con SU token. El envío es
  // a graph.facebook.com/<phone_number_id>/messages; el media entrante se sirve
  // por el proxy firmado /webhooks/whatsapp/media/:id (Cloud API exige el token
  // para descargarlo, así queda del lado del server).
  WHATSAPP_PHONE_NUMBER_ID?: string;  // el Phone Number ID del número (no el número)
  WHATSAPP_ACCESS_TOKEN?: string;     // token del system user / WABA (Bearer)
  WHATSAPP_VERIFY_TOKEN?: string;     // handshake GET del webhook (si falta, usa META_VERIFY_TOKEN)
  WHATSAPP_APP_SECRET?: string;       // firma X-Hub-Signature-256 (si falta, usa META_APP_SECRET)
  XAI_API_KEY?: string;             // xAI (Grok) — proveedor LLM alterno (ver src/llm/provider.ts)
  DEEPSEEK_API_KEY?: string;        // DeepSeek — proveedor LLM alterno (ver src/llm/provider.ts)

  // ── Cal.com (agenda real para scheduleAppointment) ───────────────────────
  // Con estas vars, el bot consulta disponibilidad real y reserva en Cal.com.
  // Sin ellas, scheduleAppointment solo registra la cita para que el dueño la confirme.
  CALCOM_API_KEY?: string;                 // secret: API key de Cal.com (cal_...)
  CALCOM_EVENT_TYPE_ID?: string;           // event type por defecto (numérico, como string)
  CALCOM_EVENT_TYPES?: string;             // opcional: JSON {"corte":123,"barba":456} servicio→eventTypeId
  CALCOM_TIMEZONE?: string;                // zona horaria (default America/Mexico_City)
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;  // base64-encoded JSON

  // ── Conectores OAuth (F5 Fase 4): Google Calendar y Jira ─────────────────
  // El bot es una "app" registrada UNA VEZ por el dueño del despliegue (en
  // Google Cloud Console / Atlassian Developer Console) — el client_id/secret
  // son del DESPLIEGUE, no del bot; cada bot autoriza el suyo (su propio
  // refresh_token) al conectar desde /admin/conexiones, igual que cualquier
  // "Iniciar sesión con Google" de una app de terceros.
  GOOGLE_CALENDAR_CLIENT_ID?: string;
  GOOGLE_CALENDAR_CLIENT_SECRET?: string;
  JIRA_CLIENT_ID?: string;
  JIRA_CLIENT_SECRET?: string;
  OWNER_EMAIL: string;  // for handoff notifications (email)
  OWNER_TELEGRAM_CHAT_ID?: string;  // for handoff notifications (default channel)
  OWNER_WA_NUMBER?: string;  // for Pro handoff WhatsApp DM (requires template)

  // HTTP Basic Auth password for the admin dashboard (secret).
  // Username is always "admin". Set via `wrangler secret put DASHBOARD_PASSWORD`.
  DASHBOARD_PASSWORD: string;

  // "1" = panel admin PÚBLICO (sin Basic Auth). Solo cuando el dueño lo decide
  // explícitamente (var en wrangler.toml); sin la var, el guard queda activo.
  DASHBOARD_PUBLIC?: string;

  // F5 de docs/multitenancy.md: login con KontrolIA Auth (OAuth 2.1 + PKCE
  // contra el GoTrue del proyecto de Supabase compartido — auth-server ES
  // Supabase Auth, no un servidor aparte). Las tres son opcionales A PROPÓSITO:
  // sin ellas, /admin/login no aparece y el panel sigue funcionando con Basic
  // Auth exactamente como hoy — no es un cambio disruptivo, es una opción que
  // se prende al configurarla.
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  // client_id que devolvió panel.kontrolia.io → Clientes OAuth al registrar
  // esta app. No es secreto (cliente público, PKCE, sin client_secret).
  OAUTH_CLIENT_ID?: string;

  // Token guarding POST /kb/reindex (header: X-Reindex-Token). Secret.
  KB_REINDEX_TOKEN: string;

  // Protege /cron/* (header: X-Tick-Token o Authorization). Lo usa el cron de
  // Vercel, que dispara por HTTP. Sin él, queda cerrado — dejarlo
  // abierto permitiría a cualquiera forzar turnos del agente y gastar LLM.
  // En un servidor Node no hace falta: el tick corre por dentro del proceso.
  TICK_TOKEN?: string;

  // Control plane (hosted): glue para que un plano de control externo lea este
  // bot self-hosted vía los endpoints /api/*. Ambos opcionales; sin el token,
  // /api/* queda cerrado (fail-closed).
  CONTROL_PLANE_TOKEN?: string;  // secret; Bearer que el control plane presenta para llamar /api/*
  CONTROL_PLANE_URL?: string;    // base URL del control plane (para reportes / license check futuros)
}
