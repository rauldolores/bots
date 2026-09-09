// Endpoint que recibe el formulario "agendar demo" y envía los datos por
// correo vía Resend a asesor@kontrolia.io (el equipo de Kontrolia agenda la
// demo de Nodia Agents).
//
// Env vars (opcionales salvo RESEND_API_KEY):
//   RESEND_API_KEY          — llave de Resend (requerida para enviar)
//   DEMO_EMAIL_TO           — destinatario (default: asesor@kontrolia.io)
//   DEMO_EMAIL_FROM         — remitente (default: onboarding@resend.dev)
//   DEMO_EMAIL_FROM_NAME    — nombre del remitente (default: Nodia Agents)
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { ipDe, registrarEnvio } from "./limite";

export const runtime = "nodejs";

interface DemoPayload {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  message?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Tope de caracteres por campo. Un formulario legítimo no se acerca ni de
 * lejos; sin el tope, el cuerpo del correo lo escribe quien llame al endpoint.
 */
const MAX_LARGO: Record<keyof DemoPayload, number> = {
  name: 120,
  email: 200,
  phone: 40,
  company: 160,
  message: 2000,
};

export async function POST(req: Request) {
  // El límite va ANTES de leer el cuerpo: a quien está abusando no se le gasta
  // ni el parseo.
  const veredicto = registrarEnvio(ipDe(req.headers));
  if (!veredicto.permitido) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message: "Recibimos varias solicitudes seguidas. Intenta de nuevo en unos minutos.",
      },
      { status: 429, headers: { "Retry-After": String(veredicto.esperaSegundos ?? 60) } },
    );
  }

  let body: DemoPayload;
  try {
    body = (await req.json()) as DemoPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  const email = (body.email ?? "").trim();
  const phone = (body.phone ?? "").trim();
  const company = (body.company ?? "").trim();
  const message = (body.message ?? "").trim();

  if (!name || !email || !phone || !company) {
    return NextResponse.json(
      { error: "missing_fields", message: "Faltan campos obligatorios." },
      { status: 400 },
    );
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "bad_email", message: "El correo electrónico no parece válido." },
      { status: 400 },
    );
  }
  // Sin tope, el cuerpo del correo lo redacta quien llame al endpoint.
  for (const [campo, valor] of Object.entries({ name, email, phone, company, message })) {
    if (valor.length > MAX_LARGO[campo as keyof DemoPayload]) {
      return NextResponse.json(
        { error: "too_long", message: `El campo "${campo}" es demasiado largo.` },
        { status: 400 },
      );
    }
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "no_api_key", message: "Resend no está configurado en el servidor." },
      { status: 500 },
    );
  }

  const to = process.env.DEMO_EMAIL_TO ?? "asesor@kontrolia.io";
  const fromAddress = process.env.DEMO_EMAIL_FROM ?? "onboarding@resend.dev";
  const fromName = process.env.DEMO_EMAIL_FROM_NAME ?? "Nodia Agents";
  const from = `${fromName} <${fromAddress}>`;

  const subject = `🧪 Demo Nodia Agents — ${name} (${company})`;

  // Redacta un correo breve: quién es, sus datos y que quiere agendar una demo.
  const text = [
    `${name} quiere agendar una demo de Nodia Agents.`,
    "",
    `• Nombre: ${name}`,
    `• Correo: ${email}`,
    `• Teléfono: ${phone}`,
    `• Empresa: ${company}`,
    message ? `• Mensaje: ${message}` : null,
    "",
    "— Solicitado desde el formulario de demo del sitio web de Nodia Agents.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from,
      to: [to],
      subject,
      text,
    });
    if (result.error) {
      console.error("[demo] resend error:", result.error);
      return NextResponse.json(
        { error: "resend_error", message: "No se pudo enviar el correo." },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[demo] resend exception:", e);
    return NextResponse.json(
      { error: "exception", message: "No se pudo enviar el correo." },
      { status: 502 },
    );
  }
}
