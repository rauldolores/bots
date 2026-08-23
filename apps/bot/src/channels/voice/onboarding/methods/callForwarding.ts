// El ÚNICO método implementado en esta fase: desvío de llamadas. El número
// del cliente nunca cambia de dueño — solo se configura, desde el propio
// teléfono/panel de su operador, para que las llamadas entrantes se
// redirijan al número de Twilio que ya conectamos (F7 fase 7).
import type { OnboardingMethodHandler } from "../types";

export const callForwardingHandler: OnboardingMethodHandler = {
  method: "call_forwarding",
  label: "Conservar mi número (desvío de llamadas)",
  description:
    "Tu número actual sigue siendo tuyo. Solo activas el desvío de llamadas desde tu operador — las llamadas que te hagan a TU número las contesta el agente.",
  buildInstructions({ destinationPhoneNumber }) {
    return {
      summary: `Configura el desvío de llamadas de tu línea actual hacia ${destinationPhoneNumber}.`,
      steps: [
        {
          title: "Activa el desvío incondicional",
          detail: `Desde el teléfono de tu línea actual, marca *21*${destinationPhoneNumber}# y espera el tono de confirmación (código GSM estándar — funciona en la mayoría de los operadores).`,
        },
        {
          title: "Si tu operador usa otro código",
          detail:
            "Busca \"activar desvío de llamadas\" + el nombre de tu operador, o pídeles el código de desvío INCONDICIONAL (a veces llamado \"unconditional call forwarding\") hacia el número de arriba.",
        },
        {
          title: "Confirma que quedó activo",
          detail: "Muchos operadores mandan un SMS de confirmación. También puedes marcar *#21# para consultar el estado del desvío.",
        },
        {
          title: "Haz una llamada de prueba",
          detail: "Desde OTRO teléfono, llama a tu número de siempre — debería contestar el agente. Aquí abajo verás en vivo si la detectamos.",
        },
      ],
      note: "El desvío se desactiva en cualquier momento marcando ##21# — tu número nunca deja de ser tuyo.",
    };
  },
};
