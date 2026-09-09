// ¿El bot cumplió lo que le dijo al cliente?
//
// La pregunta del dueño, textual: "no podemos estar adivinando si el agente lo
// guardó o no lo guardó... necesitamos tener la certeza".
//
// Y tiene razón en un sentido más fuerte del que parece: la certeza NO puede
// venir del agente. Por bueno que sea el modelo, lo único que entrega es su
// versión de los hechos — y ya pasó que esa versión fuera falsa (2026-09-07:
// "ya quedó agendada tu demo", sin cita). La certeza solo puede salir de
// comparar lo que prometió contra lo que existe en la base.
//
// Esto no reemplaza al arreglo de toolResult.ts, lo respalda: aquel evita que
// se le MIENTA al agente; éste detecta cuando el agente miente igual, o cuando
// promete algo sin siquiera intentarlo.
import type { Db } from "../../db/client";

/** Un desajuste entre lo dicho y lo hecho. */
export interface PromesaIncumplida {
  /** Qué prometió, en las palabras del bot. */
  dijo: string;
  /** Por qué se considera incumplida. */
  motivo: "herramienta_fallo" | "nunca_lo_intento";
  /** La herramienta involucrada, si se llegó a llamar. */
  herramienta?: string;
  /** El error que devolvió, si lo hubo. */
  detalle?: string;
}

/**
 * Frases con las que el bot da algo por hecho.
 *
 * Deliberadamente en pasado y en primera persona: "te agendo" (futuro) es una
 * intención y no promete nada, "ya quedó agendada" sí. Confundirlos llenaría
 * el aviso de falsos positivos, y un aviso que grita de más se ignora — que es
 * el mismo final que no tenerlo.
 */
const AFIRMACIONES = [
  "ya quedó",
  "ya quedo",
  "quedó agendada",
  "quedo agendada",
  "quedó registrada",
  "quedo registrada",
  "quedó registrado",
  "quedo registrado",
  "ya la agendé",
  "ya la agende",
  "ya te agendé",
  "ya te agende",
  "ya lo registré",
  "ya lo registre",
  "ya te registré",
  "ya te registre",
  "listo, tu cita",
  "confirmada tu cita",
  "tu cita está confirmada",
  "tu cita esta confirmada",
  "acabo de agendar",
  "acabo de registrar",
  // Transferir es la promesa más fácil de incumplir sin darse cuenta: si el
  // dueño no configuró número, la herramienta ni existe y el modelo lo dice
  // igual (llamada del 2026-09-08: "ya te estoy pasando con el equipo").
  "te estoy pasando",
  "te paso con",
  "te transfiero",
  "te comunico con",
  "voy a transferirte",
];

/** Qué herramienta respalda cada tipo de promesa. */
const RESPALDO: Record<string, string[]> = {
  cita: ["scheduleAppointment"],
  registro: ["captureLead", "handoffHuman"],
  transferencia: ["transfer_to_human"],
};

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** ¿Esta frase del bot afirma que algo YA ocurrió? */
export function afirmaHaberloHecho(texto: string): string | null {
  const t = normalizar(texto);
  for (const frase of AFIRMACIONES) {
    if (t.includes(normalizar(frase))) return frase;
  }
  return null;
}

/** De qué habla la promesa, para saber qué herramienta debió respaldarla. */
export function tipoDePromesa(texto: string): keyof typeof RESPALDO {
  const t = normalizar(texto);
  // La transferencia se revisa PRIMERO: "te paso con alguien para tu cita"
  // habla de una cita, pero lo que promete es pasar la llamada.
  // "transfer" y no "transfier": la raíz cubre transferir, transfiero,
  // transferirte y transferencia. Con "transfier" se escapaba justo la forma
  // que el bot usó de verdad — "voy a transferirte" — y caía en la rama de
  // registro, donde un ticket la daba por cumplida.
  if (t.includes("transfer") || t.includes("te paso") || t.includes("te comunico") || t.includes("estoy pasando")) {
    return "transferencia";
  }
  // El VERBO manda sobre el sustantivo. Falso positivo real (2026-09-08 18:16):
  // "quedó agendada correctamente para el viernes once" no repite la palabra
  // "reunión", así que caía en "registro", se buscaba captureLead —que no se
  // había llamado— y se reportaba una promesa incumplida sobre una cita que SÍ
  // se había agendado. Un aviso falso enseña a ignorar los avisos.
  if (t.includes("agend")) return "cita";
  return t.includes("cita") || t.includes("demo") || t.includes("llamada") || t.includes("reunion")
    ? "cita"
    : "registro";
}

interface LlamadaHecha {
  tool: string;
  ok: boolean;
  motivo?: string;
}

/**
 * Compara lo que el bot afirmó contra las herramientas que de verdad
 * funcionaron durante la llamada.
 *
 * Es a propósito determinista y sin LLM: preguntarle a un modelo si otro
 * modelo mintió agrega una segunda opinión, no una verificación. Los hechos
 * salen de voice_call_events, que los escribe el puente, no el agente.
 */
export function conciliar(
  dichosDelBot: string[],
  herramientas: LlamadaHecha[],
): PromesaIncumplida[] {
  const fallidas = herramientas.filter((h) => !h.ok);
  const exitosas = new Set(herramientas.filter((h) => h.ok).map((h) => h.tool));
  const hallazgos: PromesaIncumplida[] = [];

  for (const dicho of dichosDelBot) {
    const frase = afirmaHaberloHecho(dicho);
    if (!frase) continue;

    const esperadas = RESPALDO[tipoDePromesa(dicho)];
    if (esperadas.some((t) => exitosas.has(t))) continue; // se cumplió

    const falloRelacionado = fallidas.find((h) => esperadas.includes(h.tool));
    hallazgos.push({
      dijo: dicho.slice(0, 200),
      motivo: falloRelacionado ? "herramienta_fallo" : "nunca_lo_intento",
      herramienta: falloRelacionado?.tool,
      detalle: falloRelacionado?.motivo,
    });
  }
  return hallazgos;
}

/**
 * Los hechos de UNA llamada, leídos de donde los escribió el puente.
 *
 * `voice_call_events` es la fuente: ahí queda cada herramienta con su ok y su
 * motivo (ver toolResult.ts). Los dichos del bot salen de `messages`, que es
 * lo que se persiste en cada turno, exista o no transcripción estructurada.
 */
export async function hechosDeLaLlamada(
  db: Db,
  botId: string,
  callId: string,
  conversationId: string,
): Promise<{ dichos: string[]; herramientas: LlamadaHecha[] }> {
  const eventos = await db.all<{ payload: string }>(
    `SELECT payload FROM voice_call_events
      WHERE bot_id = ? AND call_id = ? AND event_type = 'call.tool_called'`,
    [botId, callId],
  );
  const herramientas: LlamadaHecha[] = [];
  for (const e of eventos) {
    try {
      // El payload viaja como JSON dentro de una columna JSON: puede llegar ya
      // como objeto o como texto, según el driver.
      const crudo = typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload;
      const p = typeof crudo === "string" ? JSON.parse(crudo) : crudo;
      if (p?.tool) herramientas.push({ tool: String(p.tool), ok: p.ok !== false, motivo: p.motivo });
    } catch {
      /* un evento ilegible no invalida a los demás */
    }
  }

  // Solo los turnos de ESTA llamada. La conversación se reutiliza entre
  // llamadas del mismo número (conversationKeyOf es bot+canal+teléfono), así
  // que sin acotar por tiempo se releían las promesas de llamadas anteriores y
  // se reportaban como si fueran de ésta: el mismo incumplimiento volvía a
  // avisar cada vez que la persona marcaba, y el aviso apuntaba a la llamada
  // equivocada.
  const sesion = await db.first<{ started_at: number; ended_at: number | null }>(
    `SELECT started_at, ended_at FROM voice_sessions WHERE bot_id = ? AND id = ?`,
    [botId, callId],
  );
  const desde = sesion?.started_at ?? 0;
  const hasta = sesion?.ended_at ?? Date.now();

  const mensajes = await db.all<{ content: string }>(
    `SELECT content FROM messages
      WHERE bot_id = ? AND conversation_id = ? AND role = 'assistant'
        AND created_at >= ? AND created_at <= ?
      ORDER BY created_at`,
    [botId, conversationId, desde, hasta],
  );
  return { dichos: mensajes.map((m) => m.content).filter(Boolean), herramientas };
}

/**
 * Revisa una llamada ya terminada y avisa si el bot prometió algo que no pasó.
 *
 * Nunca lanza: esto corre después de colgar y no puede estropear el cierre de
 * una llamada que para el cliente ya terminó bien.
 */
export async function verificarLlamada(
  env: { DB: unknown },
  db: Db,
  botId: string,
  callId: string,
  conversationId: string,
): Promise<PromesaIncumplida[]> {
  try {
    if (!callId || !conversationId) return [];
    const { dichos, herramientas } = await hechosDeLaLlamada(db, botId, callId, conversationId);
    const hallazgos = conciliar(dichos, herramientas);
    if (hallazgos.length === 0) return [];

    const { logVoiceEvent } = await import("./log");
    logVoiceEvent("promesa_incumplida", {
      botId,
      callId,
      cuantas: hallazgos.length,
      motivos: hallazgos.map((h) => h.motivo).join(","),
      herramientas: hallazgos.map((h) => h.herramienta ?? "ninguna").join(","),
    });

    const { recordCallEvent } = await import("./events");
    await recordCallEvent(db, botId, callId, "call.promesa_incumplida", {
      // Se guarda TAMBIÉN la frase: sin ella, un hallazgo en la bitácora dice
      // "algo se prometió y no pasó" y no hay forma de saber qué, ni de
      // distinguir un incumplimiento real de un falso positivo del
      // clasificador. Pasó: hubo que reconstruirlo leyendo la transcripción.
      hallazgos: hallazgos.map((h) => ({
        dijo: h.dijo.slice(0, 160),
        motivo: h.motivo,
        herramienta: h.herramienta,
        detalle: h.detalle,
      })),
    }).catch(() => {});

    // Al dueño se le avisa por donde ya recibe lo demás (Telegram/WhatsApp/
    // correo). Es el punto del ejercicio: que no tenga que ir a buscar si la
    // llamada cumplió — y menos enterarse por el cliente.
    const { notifyOwner } = await import("../../tools/handoffHuman");
    const primero = hallazgos[0];
    await notifyOwner(
      env as never,
      {
        reason: "El bot dijo que había hecho algo que no ocurrió",
        summary:
          `En una llamada el bot dijo: "${primero.dijo}". ` +
          (primero.motivo === "herramienta_fallo"
            ? `Pero ${primero.herramienta} falló (${primero.detalle ?? "sin detalle"}).`
            : "Pero nunca llegó a registrarlo.") +
          (hallazgos.length > 1 ? ` (y ${hallazgos.length - 1} caso(s) más en la misma llamada)` : ""),
        ticketId: callId,
        titulo: "Revisar llamada",
        ruta: "/admin/conversations",
      },
      botId,
    ).catch((e) => console.warn("[voice] no se pudo avisar de la promesa incumplida:", e));

    return hallazgos;
  } catch (e) {
    console.warn("[voice] la verificación de promesas falló:", e);
    return [];
  }
}
