// Cuánto puede pesar un archivo y cuánto espacio tiene un negocio.
//
// Dos números que no son arbitrarios:
//
// **Por archivo lo decide el canal MÁS ESTRICTO**, igual que el tope de
// botones (ver tools/ofrecerOpciones.ts). De nada sirve aceptar un PDF de
// 40 MB si Telegram no lo va a entregar: el dueño lo sube contento y el
// cliente nunca lo recibe. Los topes reales de cada canal al enviar POR URL:
//
//   imagen      WhatsApp 5 MB · Telegram sendPhoto 5 MB        → 5 MB
//   documento   Telegram 20 MB · correo ~25 MB · Mailgun, que
//               es el único que descarga los bytes en nuestro
//               servidor, 10 MB (ver channels/email/outbound.ts) → 10 MB
//
// **El espacio lo decide el plan.** Es lo que hace que esto escale sin
// regalar infraestructura: la clave `almacenamiento` se configura en los
// planes de KontrolIA, en MB. Sin plan configurado (instalación propia) rige
// ESPACIO_POR_DEFECTO_MB, porque un bot sin ningún tope es una factura sin
// tope.
//
// Sobre el costo real, que es lo que decide si esto es rentable: el
// almacenamiento no es el problema (200 MB cuestan centavos al mes). El que
// cuesta es el TRÁFICO DE SALIDA, porque cada envío hace que los servidores
// del canal descarguen el archivo. Y ese tráfico está acotado por algo que ya
// se cobra: las conversaciones del plan. Un bot con 1 000 conversaciones al
// mes que mandara el archivo más grande permitido en TODAS gasta ~10 GB de
// salida — céntimos por bot, muy por debajo de lo que paga el plan. Por eso
// el tope por archivo es la palanca que de verdad protege el margen, y por
// eso es bajo.

/** Topes por tipo, en bytes. */
export const MAX_IMAGEN_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENTO_BYTES = 10 * 1024 * 1024;

/** Espacio por bot cuando no hay plan que lo diga. */
export const ESPACIO_POR_DEFECTO_MB = 200;

/** Lo que el navegador puede ofrecer en el selector de archivos. */
export const TIPOS_DE_IMAGEN = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const TIPOS_DE_DOCUMENTO = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
] as const;

export type TipoDeMedio = "imagen" | "documento";

/** El tope que aplica a este tipo. */
export function maxBytesDe(tipo: TipoDeMedio): number {
  return tipo === "imagen" ? MAX_IMAGEN_BYTES : MAX_DOCUMENTO_BYTES;
}

/** "4.2 MB", "870 KB" — para decirle al dueño números que entienda. */
export function pesoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

export interface Rechazo {
  motivo: string;
}

/**
 * ¿Se puede guardar este archivo? Función pura: es la que se prueba, y la que
 * garantiza que el mismo criterio valga en la ruta del panel y en cualquier
 * otro lado que suba archivos después (una API, por ejemplo).
 */
export function validarArchivo(a: {
  tipo: TipoDeMedio;
  mime: string;
  bytes: number;
  usadoBytes: number;
  espacioMb: number;
}): Rechazo | null {
  const permitidos: readonly string[] =
    a.tipo === "imagen" ? TIPOS_DE_IMAGEN : TIPOS_DE_DOCUMENTO;
  if (!permitidos.includes(a.mime)) {
    return {
      motivo:
        a.tipo === "imagen"
          ? "Esa imagen no es JPG, PNG, WEBP ni GIF."
          : "Ese archivo no es PDF, Word, Excel ni texto.",
    };
  }
  if (a.bytes <= 0) return { motivo: "El archivo llegó vacío." };

  const max = maxBytesDe(a.tipo);
  if (a.bytes > max) {
    return {
      motivo:
        `Pesa ${pesoLegible(a.bytes)} y el máximo son ${pesoLegible(max)}. ` +
        (a.tipo === "imagen"
          ? "No es un capricho nuestro: WhatsApp y Telegram no entregan fotos más pesadas."
          : "Arriba de eso hay canales que no lo entregan."),
    };
  }

  const espacioBytes = a.espacioMb * 1024 * 1024;
  if (a.usadoBytes + a.bytes > espacioBytes) {
    const libre = Math.max(0, espacioBytes - a.usadoBytes);
    return {
      motivo:
        `No cabe: te quedan ${pesoLegible(libre)} de ${a.espacioMb} MB. ` +
        "Quita algún archivo que ya no uses o sube de plan.",
    };
  }
  return null;
}
