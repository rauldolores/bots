// El formulario de soporte de /admin/ayuda: manda un correo al equipo de
// Kontrolia con lo que escribió la persona MÁS el contexto que ella no
// tendría por qué saber buscar (organización, bot, plan, quién escribe).
//
// Por dónde sale el correo, en orden:
//   1. RESEND_API_KEY de despliegue (la misma llave con la que se avisa al
//      dueño en handoffHuman.ts) — es la de la plataforma, no del cliente.
//   2. Si no hay, el correo saliente que el dueño configuró para su bot
//      (/admin/config → Correo saliente), resuelto por resolveChannelEnv.
//   3. Si tampoco, se devuelve error y la pantalla ofrece el mailto directo.
import { Resend } from "resend";
import type { Env } from "../../env";
import { resolveChannelEnv } from "../../channels/effectiveEnv";
import { sendOutboundEmail } from "../../channels/email/outbound";

export const CORREO_SOPORTE_DEFAULT = "asesor@kontrolia.io";

export function correoSoporte(env: Pick<Env, "SUPPORT_EMAIL">): string {
  return (env.SUPPORT_EMAIL ?? "").trim() || CORREO_SOPORTE_DEFAULT;
}

export interface SolicitudSoporte {
  tema: string;
  mensaje: string;
  correo: string;
  telefono: string;
  contexto: {
    email: string | null;
    organizationId: string | null;
    botId: string | null;
    botName: string | null;
    plan: string | null;
    baseUrl: string;
  };
}

export type ResultadoSoporte = { ok: true } | { ok: false; error: string };

export function redactarSoporte(s: SolicitudSoporte): { subject: string; text: string } {
  const c = s.contexto;
  const subject = `🆘 Soporte Nodia Agents — ${s.tema} (${c.botName ?? c.organizationId ?? s.correo})`;
  const text = [
    `Solicitud de soporte desde el panel de Nodia Agents.`,
    "",
    `Tema: ${s.tema}`,
    "",
    s.mensaje,
    "",
    "— Cómo contactar —",
    `• Correo para responder: ${s.correo}`,
    s.telefono ? `• Teléfono / WhatsApp: ${s.telefono}` : null,
    "",
    "— Contexto (lo adjunta el panel, la persona no lo escribió) —",
    `• Usuario del panel: ${c.email ?? "sin sesión de KontrolIA (Basic Auth)"}`,
    `• Organización: ${c.organizationId ?? "—"}`,
    `• Bot: ${c.botName ?? "—"}${c.botId ? ` (${c.botId})` : ""}`,
    `• Plan: ${c.plan ?? "—"}`,
    `• Panel: ${c.baseUrl || "—"}`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
  return { subject, text };
}

export async function enviarSoporte(env: Env, s: SolicitudSoporte): Promise<ResultadoSoporte> {
  const { subject, text } = redactarSoporte(s);
  const to = correoSoporte(env);

  const apiKey = (env.RESEND_API_KEY ?? "").trim();
  if (apiKey) {
    try {
      const from = `${(env.SUPPORT_EMAIL_FROM_NAME ?? "").trim() || "Nodia Agents"} <${(env.SUPPORT_EMAIL_FROM ?? "").trim() || "onboarding@resend.dev"}>`;
      const r = await new Resend(apiKey).emails.send({ from, to: [to], replyTo: s.correo, subject, text });
      if (!r.error) return { ok: true };
      console.error("[soporte] resend:", r.error);
    } catch (e) {
      console.error("[soporte] resend:", e instanceof Error ? e.message : e);
    }
  }

  if (s.contexto.botId) {
    try {
      const envBot = await resolveChannelEnv(env, s.contexto.botId, "email");
      const r = await sendOutboundEmail(envBot, to, subject, `${text}\n\n(Responder a: ${s.correo})`);
      if (r.ok) return { ok: true };
      console.error("[soporte] correo saliente del bot:", r.error);
    } catch (e) {
      console.error("[soporte] correo saliente del bot:", e instanceof Error ? e.message : e);
    }
  }

  return { ok: false, error: `No pudimos enviar tu mensaje desde aquí. Escríbenos directo a ${to} y te atendemos igual.` };
}
