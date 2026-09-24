// Filtro de intención del correo entrante: ¿esto lo debe atender el agente?
//
// Un buzón de atención recibe mucho que NO es un cliente: agencias ofreciendo
// SEO, proveedores cotizando, facturas y avisos de plataformas, boletines que
// no traen las cabeceras de correo masivo. Sin filtro, el agente le contestaba
// a todo — y cada respuesta a un vendedor es una conversación del plan gastada
// y un correo del negocio que nadie quería mandar.
//
// Los masivos con cabeceras estándar (List-Unsubscribe, Precedence: bulk,
// noreply…) ya se descartan antes, en esCorreoAutomatico (reenvio.ts). Esto es
// para lo que parece escrito por una persona.
//
// La MISMA llamada saca de la firma nombre, empresa y teléfono: el correo ya
// está leído, extraerlos no cuesta otra llamada.
//
// Reglas que no se negocian:
//   - Falla ABIERTO. Si el modelo no contesta, no hay llave, o devuelve algo
//     raro: se atiende. Un filtro caído no puede silenciar a un cliente.
//   - Ante la duda, atender. Un vendedor al que se le contesta cuesta poco;
//     un cliente descartado es un negocio perdido.
//   - El correo original NUNCA se pierde: sigue en el buzón del negocio (el
//     reenvío es una copia). Lo filtrado solo significa "el bot no contesta".
import { generateObject } from "ai";
import { z } from "zod";
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { registrarUso } from "../../db/aiUsage";
import { BotsRepo } from "../../db/bots";
import { SettingsRepo, SETTING_KEYS } from "../../db/settings";
import { createModel } from "../../llm/provider";
import { loadLlmOverrides } from "../../settings-loader";

export type CategoriaDeCorreo = "cliente" | "vendedor" | "publicidad" | "notificacion" | "spam" | "otro";

export interface Triage {
  atender: boolean;
  categoria: CategoriaDeCorreo;
  /** Una frase para el dueño: por qué se filtró (o por qué se atiende). */
  motivo: string;
  nombre: string | null;
  empresa: string | null;
  telefono: string | null;
  /** false = no se consultó al modelo (filtro apagado, fallo, sin llave): la decisión es el "atender" por defecto. */
  clasificado: boolean;
}

/** Por debajo de esta confianza, una categoría que NO es cliente se atiende igual. */
export const CONFIANZA_MINIMA_PARA_FILTRAR = 0.75;

/** Lo que se le manda al modelo: con eso sobra para decidir, y acota el costo. */
const MAX_CARACTERES = 3_000;

const Esquema = z.object({
  categoria: z
    .enum(["cliente", "vendedor", "publicidad", "notificacion", "spam", "otro"])
    .describe(
      "cliente = alguien que es o podría ser cliente del negocio: pregunta, cotiza, pide soporte, se queja, quiere agendar. " +
        "vendedor = alguien que le quiere VENDER algo al negocio (agencias, software, proveedores ofreciendo servicios). " +
        "publicidad = boletines, promociones, marketing. notificacion = avisos automáticos (facturas, recibos, envíos, alertas de cuenta). " +
        "spam = fraude, phishing o basura. otro = nada de lo anterior.",
    ),
  confianza: z.number().min(0).max(1).describe("Qué tan seguro estás de la categoría, de 0 a 1."),
  motivo: z.string().max(160).describe("Una frase corta, en español, de por qué."),
  nombre: z.string().max(80).nullable().describe("Nombre de la PERSONA que escribe, tal como firma. null si no aparece."),
  empresa: z.string().max(80).nullable().describe("Empresa de quien escribe, si la menciona o está en la firma. null si no."),
  telefono: z.string().max(30).nullable().describe("Teléfono de quien escribe, si está en la firma o el cuerpo. null si no."),
});

function atenderSinClasificar(motivo: string): Triage {
  return { atender: true, categoria: "cliente", motivo, nombre: null, empresa: null, telefono: null, clasificado: false };
}

/** Lo que el modelo NO puede inventar: un "nombre" que es un correo, un teléfono sin dígitos suficientes. */
function limpio(valor: string | null | undefined, tipo: "nombre" | "empresa" | "telefono"): string | null {
  const v = (valor ?? "").replace(/\s+/g, " ").trim();
  if (!v) return null;
  if (tipo === "nombre" && (v.includes("@") || /\d/.test(v))) return null;
  if (tipo === "telefono" && v.replace(/\D/g, "").length < 8) return null;
  return v;
}

export async function clasificarCorreo(
  env: Env,
  botId: string,
  correo: { de: string; asunto: string; cuerpo: string },
): Promise<Triage> {
  const db = new Db(env.DB);
  try {
    const encendido = (await new SettingsRepo(db, botId).get(SETTING_KEYS.emailFiltroIntencion)) !== "0";
    if (!encendido) return atenderSinClasificar("El filtro de correos está apagado.");

    const bot = await new BotsRepo(db).getById(botId);
    const negocio = bot?.business_name ?? env.BUSINESS_NAME ?? "el negocio";
    const { model, modelId } = createModel(env, "fast", await loadLlmOverrides(env, botId));

    const { object, usage } = await generateObject({
      model,
      schema: Esquema,
      // La respuesta es un JSON de seis campos: sin tope, el SDK pide 64k.
      maxOutputTokens: 400,
      prompt: `Clasifica un correo que llegó al buzón de atención a clientes de "${negocio}".

Decide si lo debe contestar el asistente de atención (categoría "cliente") o si es otra cosa. Ante la duda, "cliente" con confianza baja: descartar a un cliente real es mucho peor que contestarle a un vendedor.

Además, saca de la FIRMA o del cuerpo el nombre de la persona que escribe, su empresa y su teléfono — solo si aparecen de forma explícita. No inventes ni deduzcas.

De: ${correo.de}
Asunto: ${correo.asunto || "(sin asunto)"}

${correo.cuerpo.slice(0, MAX_CARACTERES)}`,
    });
    await registrarUso(db, botId, { source: "filtro", modelUsed: modelId, usage });

    const esCliente = object.categoria === "cliente";
    const seguro = object.confianza >= CONFIANZA_MINIMA_PARA_FILTRAR;
    return {
      atender: esCliente || !seguro,
      categoria: object.categoria,
      motivo: object.motivo.trim(),
      nombre: limpio(object.nombre, "nombre"),
      empresa: limpio(object.empresa, "empresa"),
      telefono: limpio(object.telefono, "telefono"),
      clasificado: true,
    };
  } catch (e) {
    console.warn("[email/triage] no se pudo clasificar; se atiende:", e instanceof Error ? e.message : e);
    return atenderSinClasificar("No se pudo clasificar el correo; se atiende por si acaso.");
  }
}
