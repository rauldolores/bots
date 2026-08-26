// F8 fase B: detectar que alguien pide dejar de recibir mensajes.
//
// Deliberadamente NO es una llamada al LLM: es una guardia de cumplimiento y
// tiene que ser barata, determinista y auditable. Si el modelo falla o cambia
// de humor, alguien que escribió BAJA seguiría recibiendo mensajes — y eso, en
// WhatsApp, es lo que hace que Meta te tumbe el número.
//
// Se compara contra el mensaje COMPLETO (normalizado), no como subcadena: si
// alguien escribe "no me quiero dar de baja" o "¿cómo cancelo mi cita?", eso
// no es una baja. El costo de un falso positivo (dejar de contactar a un
// cliente que sí quería) es alto y silencioso.
const PALABRAS_DE_BAJA = new Set([
  "stop",
  "baja",
  "darme de baja",
  "dar de baja",
  "date de baja",
  "cancelar suscripcion",
  "cancelar suscripción",
  "desuscribir",
  "desuscribirme",
  "unsubscribe",
  "no me escriban",
  "no me escribas",
  "no me contacten",
  "no me contacte",
  "no me contactes",
  "no me manden mensajes",
  "no me mandes mensajes",
  "no molestar",
  "no quiero mas mensajes",
  "no quiero más mensajes",
  "ya no me escriban",
  "ya no me escribas",
  "eliminame de su lista",
  "elimíname de su lista",
  "borrame de su lista",
  "bórrame de su lista",
  "quitame de la lista",
  "quítame de la lista",
]);

/** Minúsculas, sin acentos, sin puntuación de sobra y con espacios colapsados. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[.,!¡?¿;:"'()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * true solo si el mensaje ENTERO es una petición de baja.
 *
 * Se acepta una cortesía corta alrededor ("por favor", "gracias") porque es
 * como escribe la gente de verdad, pero nada más: un mensaje largo que
 * mencione "baja" de pasada no cuenta.
 */
export function esPeticionDeBaja(texto: string | null | undefined): boolean {
  const limpio = normalizar(String(texto ?? ""));
  if (!limpio) return false;

  const sinCortesia = limpio
    .replace(/\b(por favor|porfavor|porfa|gracias|hola|buenas|buenos dias|buenas tardes|buenas noches)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return PALABRAS_DE_BAJA.has(limpio) || PALABRAS_DE_BAJA.has(sinCortesia);
}

/** Lo que el bot contesta al darlo de baja — corto y sin intentar retenerlo. */
export const MENSAJE_DE_BAJA =
  "Listo, no te vuelvo a escribir. Si algún día necesitas algo, aquí estaré.";
