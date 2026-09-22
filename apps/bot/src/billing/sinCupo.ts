// Qué pasa cuando el plan se queda sin cupo.
//
// Antes: nada. Al agotarse las conversaciones, el mensaje se reconocía al
// canal y se descartaba. El cliente del negocio escribía por WhatsApp y
// NADIE le contestaba — sin explicación, sin registro, sin que el dueño se
// enterara más que por un warn en el log. Era la peor de las salidas: el
// negocio quedaba mal con su cliente y ni siquiera lo sabía.
//
// Ahora hay dos destinatarios, con reglas distintas:
//
//   - Al CLIENTE FINAL se le contesta UNA vez, con un mensaje corto que no
//     menciona "plan" ni "límite": eso es asunto del negocio, no de quien le
//     escribe, y exponerlo lo hace quedar mal. Después la conversación se
//     pausa para no repetirle lo mismo a cada mensaje.
//
//   - Al DUEÑO se le avisa UNA vez al día, no una por mensaje, con el dato que
//     lo mueve: cuántas personas le han escrito y no han sido atendidas. Un
//     aviso por mensaje se vuelve ruido y se ignora; uno al día con "7
//     personas sin atender" se lee.
import type { Env } from "../env";
import { Db } from "../db/client";
import { SettingsRepo } from "../db/settings";
import { ConversationsRepo } from "../db/conversations";
import type { ClaveDeLimite } from "./kontrolia";
import type { UsageReport } from "@kontrolia/auth/server";

/**
 * Lo que oye el cliente final. Deliberadamente neutro: no dice por qué.
 * Pausa de un día porque la persona suele reintentar en horas; a las 24 h el
 * dueño ya tuvo su aviso y una oportunidad de subir de plan.
 */
export const MENSAJE_SIN_CUPO_CHAT =
  "Gracias por tu mensaje. En este momento no podemos atenderte por este medio, pero una persona del equipo te contactará lo antes posible.";

/** Lo que oye quien llama por teléfono cuando no quedan minutos. Corto: cada segundo de esto cuesta. */
export const MENSAJE_SIN_CUPO_VOZ =
  "Gracias por llamar. En este momento no podemos atender tu llamada. Por favor, escríbenos por WhatsApp o inténtalo más tarde.";

export const PAUSA_SIN_CUPO_MS = 24 * 60 * 60_000;

/** Un aviso al dueño por clave de límite, como mucho cada 24 h. */
const CADA_MS = 24 * 60 * 60_000;

/** Claves de settings. Se arman por límite para que "conversaciones" y "llamadas" lleven cuentas separadas. */
const claveAvisadoAt = (limite: ClaveDeLimite) => `sin_cupo_avisado_at:${limite}`;
const claveAfectados = (limite: ClaveDeLimite) => `sin_cupo_afectados:${limite}`;
const claveExcedenteAvisadoAt = (limite: ClaveDeLimite) => `excedente_avisado_at:${limite}`;

/**
 * Registra a una persona más que se quedó sin atender y, si toca, avisa al
 * dueño. Nunca lanza: esto corre en el camino de un webhook y un fallo al
 * avisar no puede impedir que se le conteste al cliente.
 *
 * Devuelve `true` si en esta llamada se mandó el aviso.
 */
export async function registrarSinCupo(
  env: Env,
  botId: string,
  limite: ClaveDeLimite,
  usage: UsageReport | null,
): Promise<boolean> {
  try {
    const db = new Db(env.DB);
    const settings = new SettingsRepo(db, botId);

    const afectados = Number((await settings.get(claveAfectados(limite))) ?? "0") + 1;
    await settings.set(claveAfectados(limite), String(afectados));

    const ultimo = Number((await settings.get(claveAvisadoAt(limite))) ?? "0");
    if (Number.isFinite(ultimo) && ultimo > 0 && Date.now() - ultimo < CADA_MS) return false;

    // Toca avisar. El contador se reinicia AL AVISAR, así el siguiente aviso
    // dice cuántos se acumularon desde éste, no desde el principio del mes.
    await settings.set(claveAvisadoAt(limite), String(Date.now()));
    await settings.set(claveAfectados(limite), "0");

    const { notifyOwner } = await import("../tools/handoffHuman");
    await notifyOwner(
      env,
      {
        reason: "Tu plan llegó al límite",
        summary: resumenParaElDueno(limite, usage, afectados),
        ticketId: `sin-cupo-${limite}`,
        titulo: "Plan al límite",
        ruta: "/admin/plan",
      },
      botId,
    );
    return true;
  } catch (e) {
    console.warn(`[billing] no se pudo avisar al dueño del límite de ${limite}:`, e);
    return false;
  }
}

/**
 * Excedente con precio (billing.md B7b): el límite se agotó pero el plan
 * cobra la unidad extra, así que NO se corta nada — se sigue atendiendo y
 * al dueño se le avisa UNA vez al día que desde ahora paga por cada extra,
 * con el precio y lo acumulado. Mismo ritmo (uno al día) pero llave propia:
 * si hoy se avisó "sin cupo" y el dueño sube a un plan que cobra el extra,
 * el aviso de excedente no debe quedar silenciado. Nunca lanza.
 */
export async function avisarExcedente(env: Env, botId: string, limite: ClaveDeLimite, usage: UsageReport): Promise<boolean> {
  try {
    const { avisoDeExcedente, resumenDeExcedente } = await import("./kontrolia");
    const aviso = avisoDeExcedente(limite, usage);
    if (!aviso) return false;
    const settings = new SettingsRepo(new Db(env.DB), botId);
    const ultimo = Number((await settings.get(claveExcedenteAvisadoAt(limite))) ?? "0");
    if (Number.isFinite(ultimo) && ultimo > 0 && Date.now() - ultimo < CADA_MS) return false;
    await settings.set(claveExcedenteAvisadoAt(limite), String(Date.now()));
    const { esPrepago } = await import("./kontrolia");
    const prepago = esPrepago(usage);
    const acumulado = resumenDeExcedente(limite, usage);
    const { notifyOwner } = await import("../tools/handoffHuman");
    await notifyOwner(
      env,
      {
        reason: prepago ? "Tu plan llegó al límite — seguimos con tu saldo" : "Tu plan llegó al límite — seguimos atendiendo",
        summary: prepago
          ? `${aviso}${acumulado ? ` ${acumulado}.` : ""} Cuando llegue a cero dejaremos de atender: compra un paquete en Plan y facturación.`
          : `${aviso}${acumulado ? ` Llevas ${acumulado}.` : ""} El extra aparece en tu siguiente factura; si prefieres, sube de plan en Plan y facturación.`,
        ticketId: `excedente-${limite}`,
        titulo: prepago ? "Plan al límite: consumiendo saldo" : "Plan al límite: cobrando excedente",
        ruta: "/admin/plan",
      },
      botId,
    );
    return true;
  } catch (e) {
    console.warn(`[billing] no se pudo avisar al dueño del excedente de ${limite}:`, e);
    return false;
  }
}

/** Al admitir de nuevo (hubo cupo), el contador de afectados deja de crecer; no hay nada que reiniciar. */
export function resumenParaElDueno(limite: ClaveDeLimite, usage: UsageReport | null, afectados: number): string {
  const uso = usage ? `${usage.used} de ${usage.limit}${usage.period === "month" ? " este mes" : ""}` : "el máximo";
  const que =
    limite === "llamadas"
      ? `minutos de llamadas (${uso})`
      : limite === "conversaciones"
        ? `conversaciones (${uso})`
        : `${limite} (${uso})`;
  const quienes =
    limite === "llamadas"
      ? `${afectados} ${afectados === 1 ? "persona ha llamado" : "personas han llamado"} y no ${afectados === 1 ? "fue" : "fueron"} atendida${afectados === 1 ? "" : "s"}`
      : `${afectados} ${afectados === 1 ? "persona te ha escrito" : "personas te han escrito"} y no ${afectados === 1 ? "ha" : "han"} sido atendida${afectados === 1 ? "" : "s"}`;
  return `Llegaste al límite de ${que}. Desde entonces ${quienes}. Súbelo en Plan y facturación para seguir atendiendo.`;
}

/** Cuántas conversaciones siguen esperando cupo — para el panel. */
export async function conversacionesSinAtender(env: Env, botId: string): Promise<number> {
  return new ConversationsRepo(new Db(env.DB), botId).contarSinCupo();
}
