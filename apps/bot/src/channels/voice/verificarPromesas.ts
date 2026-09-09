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
 * Cómo se detecta que el bot dio algo por hecho.
 *
 * Antes esto era una lista de frases exactas ("ya quedó", "ya te agendé"…) y
 * el problema de esa forma es que siempre va una frase atrás. Lo demostró la
 * llamada del 2026-09-09: el bot dijo "Listo, Federico, ya dejé registrado
 * que no te han llamado" —sin haber llamado ninguna herramienta— y como
 * "ya dejé registrado" no estaba en la lista, el aviso nunca salió. Agregar
 * esa frase habría dejado fuera la siguiente.
 *
 * Ahora se detecta la ESTRUCTURA: una marca de hecho consumado ("ya",
 * "listo", "acabo de", "quedó") junto a un verbo de acción que solo puede
 * cumplirse con una herramienta ("registré", "agendé", "anoté", "comenté").
 * Eso cubre las formas que todavía no se han visto, que son justo las que
 * importan.
 */
const MARCA_DE_HECHO = /\b(ya|listo|acabo de|acabamos de|hecho|quedo|queda)\b/;

/**
 * Verbos que NO se cumplen hablando: hacen falta datos escritos en algún lado.
 *
 * En pasado o participio a propósito. "Te lo voy a registrar" es una
 * intención y no promete nada todavía; "ya lo registré" sí. Confundirlos
 * llenaría el aviso de falsos positivos, y un aviso que grita de más se
 * ignora — que es el mismo final que no tenerlo.
 */
const ACCION_CUMPLIDA =
  /\b(registr(e|é|ado|ada|amos)|agend(e|é|ada|ado|amos)|guard(e|é|ado|ada|amos)|anot(e|é|ado|ada|amos)|coment(e|é|ado|ada|amos)|abr(i|í|imos)|cre(e|é|ado|ada|amos)|actualic(e|é)|actualiz(ado|ada|amos)|deje|dejé|dejamos|envi(e|é|ado|ada|amos)|mand(e|é|ado|ada|amos)|añad(i|í|ido|ida)|agregu(e|é)|agreg(ado|ada))\b/;

/** Prometer que la llamada pasa a otra persona: se incumple sin darse cuenta. */
const TRANSFERENCIA_EN_CURSO = /\b(te (paso|transfiero|comunico)|estoy pasando|voy a transferirte|te estoy comunicando)\b/;

/** Qué herramienta respalda cada tipo de promesa. */
const RESPALDO: Record<string, string[]> = {
  cita: ["scheduleAppointment"],
  registro: ["captureLead", "handoffHuman"],
  transferencia: ["transfer_to_human"],
  // Una nota o un comentario en el CRM se escribe con una tool del conector
  // MCP, y el nombre de ésa lo elige el dueño al conectarlo ("Vinqulia" →
  // `vinqulia_mutate`). Por eso aquí no puede ir una lista fija: se resuelve
  // por forma en `respaldaLaNota`.
  nota: [],
};

/**
 * ¿Esta herramienta que sí corrió pudo haber escrito la nota o el comentario?
 *
 * Se decide por el nombre porque el del conector MCP lo pone el dueño y no lo
 * conocemos de antemano. Es una heurística, y se prefiere pecar de generosa:
 * dar por cumplida una promesa de más solo calla un aviso dudoso, mientras
 * que un aviso falso enseña a ignorar los que sí importan.
 */
function respaldaLaNota(tool: string): boolean {
  return /mutate|insert|create|update|add|note|nota|coment|complete|task|tarea|handoff/i.test(tool);
}

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** ¿Esta frase del bot afirma que algo YA ocurrió? Devuelve el fragmento que lo dice. */
export function afirmaHaberloHecho(texto: string): string | null {
  const t = normalizar(texto);
  if (TRANSFERENCIA_EN_CURSO.test(t)) return t.match(TRANSFERENCIA_EN_CURSO)![0];
  // Las dos cosas, no una: "ya te confirmo el precio" tiene la marca pero
  // ningún verbo que necesite herramienta, y "te lo registro enseguida" tiene
  // el verbo pero en futuro. Ninguna de las dos promete que algo ya pasó.
  if (MARCA_DE_HECHO.test(t) && ACCION_CUMPLIDA.test(t)) return t.match(ACCION_CUMPLIDA)![0];
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
  // Una nota o un comentario sobre un caso que YA existe. Va antes de "cita"
  // porque la frase suele nombrar el caso ("dejé un comentario en tu ticket")
  // y no debe confundirse con agendar nada.
  if (/coment|nota|anot|observacion|seguimiento en (tu|el|su)/.test(t)) return "nota";
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

    const tipo = tipoDePromesa(dicho);
    // La regla más fuerte y la que no depende de acertarle a la familia: si el
    // bot afirmó haber hecho algo y en TODA la llamada no funcionó ni una sola
    // herramienta, no hay forma de que lo haya hecho. Punto.
    //
    // Existe porque el mapeo frase→herramienta puede fallar y de hecho falló:
    // el 2026-09-09 el bot dijo "ya dejé registrado tu comentario" en una
    // llamada con CERO herramientas ejecutadas, y el aviso no salió porque la
    // frase no estaba en la lista de entonces. Ese caso —el más grave y el
    // más fácil de comprobar— ahora se detecta sin tener que adivinar qué
    // herramienta le tocaba.
    // Solo cuando NO se llamó a ninguna. Si alguna corrió y falló, la rama de
    // abajo dice CUÁL y por qué — un dato que este atajo borraría.
    if (herramientas.length === 0) {
      hallazgos.push({ dijo: dicho.slice(0, 200), motivo: "nunca_lo_intento" });
      continue;
    }

    const esperadas = RESPALDO[tipo];
    const cumplida =
      tipo === "nota"
        ? [...exitosas].some(respaldaLaNota)
        : esperadas.some((t) => exitosas.has(t));
    if (cumplida) continue;

    const falloRelacionado = fallidas.find((h) =>
      tipo === "nota" ? respaldaLaNota(h.tool) : esperadas.includes(h.tool),
    );
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
