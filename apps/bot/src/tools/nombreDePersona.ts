// ¿Esto es el nombre de una persona, o un relleno que puso el modelo?
//
// Las herramientas que registran algo a nombre de alguien (ticket, cita,
// lead) reciben el nombre del modelo, y el modelo, cuando no lo sabe, a veces
// lo inventa con lo que tiene a mano: "Cliente", "Usuario", "N/A". Pasó en
// las pruebas automáticas del 2026-09-24: una demo quedó agendada a nombre de
// "Cliente" y así se creó el contacto en el CRM. Un relleno cuenta como NO
// saber el nombre.
//
// Sirve para cualquier giro: no hay nada aquí de un negocio en particular,
// solo las palabras genéricas con que se nombra a quien no se conoce.
const RELLENOS = new Set([
  "cliente",
  "el cliente",
  "la cliente",
  "usuario",
  "el usuario",
  "visitante",
  "prospecto",
  "contacto",
  "persona",
  "desconocido",
  "desconocida",
  "anonimo",
  "anónimo",
  "sin nombre",
  "no proporcionado",
  "no especificado",
  "n/a",
  "na",
  "none",
  "null",
  "undefined",
  "customer",
  "user",
  "unknown",
  "guest",
  "lead",
  "-",
]);

/** El nombre limpio si es de una persona; null si viene vacío o es un relleno. */
export function nombreDePersona(valor: string | null | undefined): string | null {
  const limpio = (valor ?? "").replace(/\s+/g, " ").trim();
  if (!limpio) return null;
  if (RELLENOS.has(limpio.toLowerCase())) return null;
  // Un correo o un número no son un nombre (el modelo a veces los repite ahí).
  if (limpio.includes("@") || /^\+?[\d\s().-]+$/.test(limpio)) return null;
  return limpio.slice(0, 80);
}
