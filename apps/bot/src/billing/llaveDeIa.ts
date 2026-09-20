// De quién es la llave con la que piensa el bot.
//
// Antes: la del dueño si la puso; si no, la del entorno (ANTHROPIC_API_KEY)
// en silencio. En una instalación propia eso está bien — la del entorno es
// la del mismo dueño. En el SaaS no: la del entorno es de Kontrolia, y un bot
// en prueba gratis sin llave propia corría Haiku/Sonnet a nuestra cuenta sin
// que nadie lo decidiera.
//
// Ahora la regla es explícita y sale del plan:
//
//   propia     El dueño puso su llave → proveedor y modelo libres, como siempre.
//   incluida   Plan PAGADO sin llave propia → la llave de Kontrolia
//              (OPENAI_API_KEY) con el modelo barato FIJO. No se puede
//              cambiar el modelo sin traer llave: es lo que el precio cubre.
//   sin_llave  Prueba gratis, o sin plan, sin llave propia → el bot NO
//              responde. La prueba es para conocer la plataforma con tu
//              propia llave, sin costo para nosotros; al pagar entra la
//              incluida.
//   libre      No es el SaaS (sin API key de KontrolIA), o el bot no tiene
//              organización → lo de siempre: llaves del entorno, sin política.
import type { Env } from "../env";
import type { Db } from "../db/client";
import { BotsRepo } from "../db/bots";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";
import type { LlmOverrides } from "../llm/provider";
import { usageConfig } from "./kontrolia";
import { estadoDeSuscripcion } from "./suscripcion";

/** El modelo de la IA incluida. Barato a propósito: ≈ $0.35 MXN por conversación. */
export const MODELO_INCLUIDO = "gpt-4.1-mini";

export type MotivoSinLlave = "trial" | "sin_plan" | "sin_llave_del_sistema";

export type PoliticaDeIa =
  | { modo: "propia" }
  | { modo: "incluida"; modelo: string }
  | { modo: "sin_llave"; motivo: MotivoSinLlave }
  | { modo: "libre" };

/** Estados de suscripción que ya pagan (past_due sigue vivo dentro del periodo de gracia del auth-server). */
const PAGANDO = new Set(["active", "past_due"]);

export async function politicaDeIa(
  env: Env,
  db: Db,
  botId: string,
  /** Si ya se leyeron los settings (con secretos), se pasan para no leerlos dos veces. */
  settings?: Record<string, string>,
): Promise<PoliticaDeIa> {
  const ajustes = settings ?? (await new SettingsRepo(db, botId).allWithSecrets());
  if ((ajustes[SETTING_KEYS.llmApiKey] ?? "").trim() !== "") return { modo: "propia" };

  // Sin API key de KontrolIA no es el SaaS: instalación propia, llaves propias.
  if (!usageConfig(env)) return { modo: "libre" };
  const bot = await new BotsRepo(db).getById(botId);
  if (!bot?.organization_id) return { modo: "libre" };

  let suscripcion;
  try {
    suscripcion = await estadoDeSuscripcion(db, env, bot.organization_id);
  } catch (e) {
    // Sin el dato no se puede aplicar la regla. Se degrada a lo de antes en
    // vez de dejar mudo al bot: un rato de Haiku a nuestra cuenta cuesta
    // centavos; un bot que no contesta le cuesta clientes al negocio.
    console.warn("[billing] no se pudo leer la suscripción — la IA sigue como antes:", e instanceof Error ? e.message : e);
    return { modo: "libre" };
  }

  if (suscripcion && PAGANDO.has(suscripcion.status)) {
    if (!(env.OPENAI_API_KEY ?? "").trim()) return { modo: "sin_llave", motivo: "sin_llave_del_sistema" };
    return { modo: "incluida", modelo: MODELO_INCLUIDO };
  }
  return { modo: "sin_llave", motivo: suscripcion?.status === "trialing" ? "trial" : "sin_plan" };
}

/**
 * Lo que el dueño configuró, pasado por la política. En "incluida" lo del
 * dueño (proveedor/modelo sin llave) se ignora: el modelo va fijo. En
 * "sin_llave" sale un bloqueo que createModel respeta lanzando, para que
 * NINGÚN camino (turno, análisis del CRM, seguimientos, insights) caiga a la
 * llave del entorno por accidente.
 */
export function aplicarPolitica(env: Env, ov: LlmOverrides, politica: PoliticaDeIa): LlmOverrides {
  switch (politica.modo) {
    case "incluida":
      return { provider: "openai", apiKey: env.OPENAI_API_KEY, model: politica.modelo };
    case "sin_llave":
      return { bloqueo: politica.motivo };
    default:
      return ov;
  }
}

/** Para el panel: qué decirle al dueño según su caso. */
export function explicacionDeIa(politica: PoliticaDeIa): { titulo: string; detalle: string; alerta: boolean } {
  switch (politica.modo) {
    case "propia":
      return { titulo: "Tu propia llave", detalle: "El consumo de IA se cobra a tu cuenta con el proveedor. Puedes elegir el modelo que quieras.", alerta: false };
    case "incluida":
      return {
        titulo: "IA incluida en tu plan",
        detalle: `Tu bot piensa con ${politica.modelo}, sin costo adicional. Si prefieres otro modelo (Claude, GPT-4.1, Grok…), pon tu propia llave y elígelo abajo.`,
        alerta: false,
      };
    case "sin_llave":
      switch (politica.motivo) {
        case "trial":
          return {
            titulo: "Tu bot no responde: falta tu llave de IA",
            detalle:
              "Durante la prueba gratis el bot usa tu propia llave (OpenAI, Anthropic, xAI o DeepSeek) — así conoces la plataforma sin costo para nadie. Al pagar el plan, la IA queda incluida y ya no necesitas llave.",
            alerta: true,
          };
        case "sin_plan":
          return {
            titulo: "Tu bot no responde: sin plan activo",
            detalle: "Elige un plan en Plan y facturación para que la IA quede incluida, o pon tu propia llave de IA aquí.",
            alerta: true,
          };
        default:
          return {
            titulo: "Tu bot no responde: la IA incluida no está disponible",
            detalle: "Es un problema de nuestro lado, ya estamos avisados. Mientras, puedes poner tu propia llave para seguir atendiendo.",
            alerta: true,
          };
      }
    default:
      return { titulo: "Llave del sistema", detalle: "El bot usa la llave configurada en el entorno de esta instalación.", alerta: false };
  }
}

/** Lo que ve el dueño en el sandbox cuando escribe y no hay con qué contestar. */
export function mensajeDeSandboxSinLlave(motivo: MotivoSinLlave): string {
  return `⚠️ ${explicacionDeIa({ modo: "sin_llave", motivo }).detalle} Configúrala en Configuración → Modelo de IA.`;
}

/** Un aviso al dueño por día, como mucho: el mismo criterio que el aviso de cupo agotado. */
const CADA_MS = 24 * 60 * 60_000;
const CLAVE_AVISADO = "sin_ia_avisado_at";

/**
 * Llegó un mensaje de cliente y el bot no tiene con qué contestar. Nunca
 * lanza: corre en el camino del webhook.
 */
export async function avisarSinLlave(env: Env, botId: string, motivo: MotivoSinLlave): Promise<boolean> {
  try {
    const { Db } = await import("../db/client");
    const settings = new SettingsRepo(new Db(env.DB), botId);
    const ultimo = Number((await settings.get(CLAVE_AVISADO)) ?? "0");
    if (Number.isFinite(ultimo) && ultimo > 0 && Date.now() - ultimo < CADA_MS) return false;
    await settings.set(CLAVE_AVISADO, String(Date.now()));

    const { titulo, detalle } = explicacionDeIa({ modo: "sin_llave", motivo });
    const { notifyOwner } = await import("../tools/handoffHuman");
    await notifyOwner(
      env,
      { reason: titulo, summary: `${detalle} Un cliente te escribió y se quedó sin respuesta.`, ticketId: "sin-ia", titulo: "Bot sin IA", ruta: "/admin/config?section=modelo" },
      botId,
    );
    return true;
  } catch (e) {
    console.warn("[billing] no se pudo avisar al dueño de que el bot no tiene IA:", e);
    return false;
  }
}
