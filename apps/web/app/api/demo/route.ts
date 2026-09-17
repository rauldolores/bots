// Endpoint que recibe el formulario "agendar demo" — y, con `paso:
// "enterprise"`, el de /enterprise — y envía los datos por correo vía Resend
// a asesor@kontrolia.io (el equipo de Kontrolia agenda la demo o llama).
//
// Enterprise: el navegador manda modalidad, conversaciones y minutos; la
// estimación se RECALCULA aquí con content/enterprise.ts. Lo que el prospecto
// vio en pantalla y lo que llega al correo salen de la misma función.
//
// Env vars (opcionales salvo RESEND_API_KEY):
//   RESEND_API_KEY          — llave de Resend (requerida para enviar)
//   DEMO_EMAIL_TO           — destinatario (default: asesor@kontrolia.io)
//   DEMO_EMAIL_FROM         — remitente (default: onboarding@resend.dev)
//   DEMO_EMAIL_FROM_NAME    — nombre del remitente (default: Nodia Agents)
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { ipDe, registrarEnvio } from "./limite";
import { estimar, mxn, mxn2, num, MODALIDAD_LABEL, type Modalidad } from "@/content/enterprise";

export const runtime = "nodejs";

interface DemoPayload {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  message?: string;
  /** "enterprise" viene del formulario de /enterprise; ausente = demo normal. */
  paso?: string;
  modalidad?: string;
  conversaciones?: number;
  minutos?: number;
}

type CampoTexto = "name" | "email" | "phone" | "company" | "message";

function enteroEntre(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r < min || r > max ? null : r;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Tope de caracteres por campo. Un formulario legítimo no se acerca ni de
 * lejos; sin el tope, el cuerpo del correo lo escribe quien llame al endpoint.
 */
const MAX_LARGO: Record<CampoTexto, number> = {
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
    if (valor.length > MAX_LARGO[campo as CampoTexto]) {
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

  const datos = [
    `• Nombre: ${name}`,
    `• Correo: ${email}`,
    `• Teléfono: ${phone}`,
    `• Empresa: ${company}`,
    message ? `• Mensaje: ${message}` : null,
  ];

  let subject = `🧪 Demo Nodia Agents — ${name} (${company})`;
  let lineas: (string | null)[];

  if (body.paso === "enterprise") {
    const modalidad: Modalidad = body.modalidad === "servidores" ? "servidores" : "nube";
    const conversaciones = enteroEntre(body.conversaciones, 1, 1_000_000);
    const minutos = enteroEntre(body.minutos, 0, 1_000_000);
    if (conversaciones === null || minutos === null) {
      return NextResponse.json(
        { error: "bad_estimate", message: "Las cifras de la calculadora no son válidas." },
        { status: 400 },
      );
    }
    const r = estimar({ modalidad, conversaciones, minutos });
    const e = r.ok ? r.estimacion : null;
    subject = `🏢 Enterprise Nodia Agents — ${company} (${name})`;
    lineas = [
      `${name} (${company}) pide una propuesta Enterprise de Nodia Agents.`,
      "",
      ...datos,
      "",
      "Lo que estimó en la calculadora (recalculado en el servidor):",
      `• Modalidad: ${MODALIDAD_LABEL[modalidad]}`,
      `• Conversaciones al mes: ${num(conversaciones)}`,
      `• Minutos de voz al mes: ${num(minutos)}`,
      e
        ? `• Banda: ${e.banda.id} (hasta ${num(e.banda.hastaConversaciones)} conversaciones/mes, ${num(e.banda.minutosIncluidos)} min de voz incluidos)`
        : "• Volumen por encima de la última banda: cotización a la medida.",
      e ? `• Licencia anual: ${mxn(e.licencia)} MXN` : null,
      e ? `• Implementación (una vez): ${mxn(e.implementacion)} MXN` : null,
      e && e.minutosExtra > 0
        ? `• Voz por encima de lo incluido: ${num(e.minutosExtra)} min/mes ≈ ${mxn(e.vozExtraAnual)} MXN/año`
        : null,
      e ? `• Primer año estimado: ${mxn(e.primerAnio)} MXN` : null,
      e ? `• Desde el segundo año: ${mxn(e.desdeSegundoAnio)} MXN (${mxn(e.mensualDesdeSegundoAnio)}/mes)` : null,
      e ? `• Por conversación: ${mxn2(e.porConversacion)} MXN` : null,
      "",
      "Siguiente paso acordado en el sitio: llamada de 30 minutos para validar el volumen y proponer el piloto.",
      "",
      "— Solicitado desde /enterprise en el sitio web de Nodia Agents.",
    ];
  } else {
    lineas = [
      `${name} quiere agendar una demo de Nodia Agents.`,
      "",
      ...datos,
      "",
      "— Solicitado desde el formulario de demo del sitio web de Nodia Agents.",
    ];
  }

  const text = lineas.filter((line): line is string => line !== null).join("\n");

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
