import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { LeadsRepo, leadMetadata } from "../db/leads";
import { NurtureSequencesRepo } from "../db/nurtureSequences";
import { ConversationsRepo } from "../db/conversations";
import { BotConnectorsRepo } from "../db/botConnectors";
import { BotsRepo } from "../db/bots";
import { resolveConnectorCreds } from "../connectors/creds";
import { CRM_ADAPTERS } from "../connectors/registry";
import type { CrmLeadInput } from "../connectors/types";
import { registerLeadContacts } from "../contacts/register";
import { encolarPostCaptura } from "../leads/postCaptura";
import { classifyContact, normalizePhone, normalizeEmail, phoneVariants, regionForTimezone } from "../contacts/normalize";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";

export function captureLeadTool(env: Env, getConversationId: () => string | null, botId: string) {
  return tool({
    description:
      "Registra una OPORTUNIDAD de venta. Úsala en cuanto el cliente muestre intención de compra: pide precios, pide una cotización, dice que le interesa, pregunta por un servicio. NO esperes a que cierre ni a tener todos los datos — capturar temprano es el objetivo. " +
      "Es la tool correcta AUNQUE tú no puedas dar el precio y haya que pasárselo a alguien del equipo: eso es una venta en curso, no un ticket de soporte. " +
      "Guarda localmente y, si hay un CRM conectado, da de alta ahí el contacto, la empresa, la oportunidad y una tarea de seguimiento para el equipo. " +
      "Pídele SIEMPRE las tres cosas: correo, teléfono y empresa. Si solo te da uno de los dos medios de contacto, no insistas más de una vez — con uno basta para guardar. " +
      "Sin NINGÚN medio de contacto la captura se rechaza (salvo que el canal ya traiga su contacto de por sí, como el teléfono en WhatsApp/una llamada, o la dirección en un correo).",
    inputSchema: z.object({
      name: z.string().optional().describe("Nombre del cliente"),
      email: z.string().optional().describe("Su correo. Pídeselo aunque ya tengas el teléfono."),
      phone: z.string().optional().describe("Su teléfono. Pídeselo aunque ya tengas el correo."),
      intent: z.string().describe("Qué quiere el cliente, en 1-2 frases"),
      notes: z.string().optional(),
      company: z
        .string()
        .optional()
        .describe(
          "Empresa o negocio desde el que nos contacta. PREGÚNTASELA siempre — si no la mencionó, pregúntale de qué empresa nos contacta antes de llamar esta tool. Nunca la inventes ni la confundas con el nombre de la persona.",
        ),
      estimatedValue: z
        .number()
        .optional()
        .describe(
          "Monto o presupuesto que el cliente mencionó, como número, SOLO si dio una cifra concreta (ej. \"tengo like $5000 de presupuesto\" → 5000). Nunca lo inventes ni lo estimes tú.",
        ),
    }),
    execute: async ({ name, email, phone, intent, notes, company, estimatedValue }) => {
      const convId = getConversationId();
      const db = new Db(env.DB);
      const leads = new LeadsRepo(db, botId);
      // channel_user_id (no el nombre/contacto que el cliente escribió) es la
      // llave con la que el bot lo reconoce si vuelve a escribir semanas después
      // — ver findLatestByChannelUserId, usado en runner.ts.
      const conv = convId ? await new ConversationsRepo(db, botId).getById(convId) : null;

      const region = regionForTimezone(await new SettingsRepo(db, botId).get(SETTING_KEYS.timezone));
      // Se piden por separado (antes era UN campo "teléfono o email" y había que
      // adivinar cuál era), pero se validan igual: lo que el modelo escriba en
      // `email` puede ser un teléfono y al revés, así que cada uno se clasifica
      // por su contenido y no por el campo donde vino.
      const clasificados = [email, phone]
        .map((v) => classifyContact(v, region))
        .filter((c): c is NonNullable<typeof c> => c !== null);
      const correo = clasificados.find((c) => c.kind === "email") ?? null;
      const telefono = clasificados.find((c) => c.kind === "phone") ?? null;

      // Si el canal por el que escribe YA es un teléfono (WhatsApp, voz) o un
      // correo (canal "email", F9), ese dato cuenta como medio de contacto
      // aunque el LLM no haya llenado nada — ya sabemos cómo llegarle. Un
      // canal opaco (Telegram, Messenger, widget) no cuenta: solo sirve
      // dentro de esa conversación.
      const convPhone = conv ? normalizePhone(conv.channel_user_id, region) : null;
      const convEmail = conv && !convPhone ? normalizeEmail(conv.channel_user_id) : null;

      // Obligatorio: sin un teléfono o correo real no hay forma de contactar
      // al lead después de esta conversación. Mejor no guardar nada que
      // guardar un lead al que nadie le puede volver a escribir.
      if (!correo && !telefono && !convPhone && !convEmail) {
        return {
          leadId: null,
          captured: false,
          message:
            "No se guardó el lead: falta un teléfono o correo válido para poder contactarlo. Pídeselos al cliente y vuelve a llamar esta tool con esos datos.",
        };
      }

      // Lo que se guarda en leads.contact (lo que el dueño VE en /admin/leads y
      // en el CSV): el correo si lo hay, si no el teléfono. Los DOS quedan
      // completos y tipados en lead_contacts — esa tabla existe justo para eso.
      const effectiveContact = correo?.addressRaw ?? telefono?.addressRaw ?? convPhone ?? convEmail;

      // Evita duplicados: si este mismo contacto ya tiene un lead ABIERTO
      // (el cliente insiste en la misma conversación, o el modelo llamó la
      // tool dos veces para lo mismo), se actualiza ese en vez de crear uno
      // nuevo — ver LeadsRepo.findOpenByContactAddress/mergeCapture. Se buscan
      // por AMBOS medios: puede que el lead viejo se haya guardado con el otro.
      const addressNorms = [
        ...(correo ? [correo.addressNorm] : []),
        ...(telefono ? phoneVariants(telefono.addressNorm) : []),
        ...(convPhone ? phoneVariants(convPhone) : []),
        ...(convEmail ? [convEmail] : []),
      ];
      const existing = await leads.findOpenByContactAddress(addressNorms);

      // Empresa/monto capturados, si el cliente los dio — se guardan en el
      // mismo bolsón de metadata que ya usan los campos de nicho, así que
      // aparecen gratis en la sección "Datos" del detalle del lead.
      const metadata: Record<string, string | number | null> = {};
      if (company) metadata.empresa = company;
      if (estimatedValue !== undefined) metadata.presupuesto_estimado = estimatedValue;

      let leadId: string;
      let isNew: boolean;
      if (existing) {
        leadId = existing.id;
        isNew = false;
        await leads.mergeCapture(leadId, { name, contact: effectiveContact ?? undefined, intent, notes, metadata });
      } else {
        leadId = await leads.create({
          conversationId: convId,
          name,
          contact: effectiveContact ?? undefined,
          channelUserId: conv?.channel_user_id ?? null,
          intent,
          notes,
          metadata,
        });
        isNew = true;
      }

      // F8 fase B: además del texto libre de arriba, el contacto queda TIPADO
      // y normalizado en lead_contacts — es lo único que después permite
      // cruzarlo, consultarlo y saber si se le puede escribir. `contact` se
      // conserva tal cual: es lo que ve el dueño y lo que se empuja al CRM.
      // Idempotente (ON CONFLICT DO NOTHING) — correrlo sobre un lead que ya
      // existía no duplica nada.
      await registerLeadContacts(db, botId, leadId, [correo?.addressRaw, telefono?.addressRaw], conv).catch((e) =>
        console.error("[captureLead] no se pudieron registrar los contactos tipados:", e),
      );

      // Lo que sigue —inscribir el seguimiento, empujar al CRM, avisarle al
      // dueño— se ENCOLA en vez de esperarse. Las dos últimas son de red, y
      // esperarlas costó una llamada real: el puente de voz corta cualquier
      // tool a los 8 s, así que al modelo se le respondió "timeout" cuando el
      // lead YA estaba guardado. Volvió a pedirle los datos al cliente y lo
      // guardó otra vez. Ver src/leads/postCaptura.ts.
      //
      // Aquí adentro solo queda lo que toca NUESTRA base y es lo único que de
      // verdad no se puede perder.
      await encolarPostCaptura(db, botId, {
        leadId,
        isNew,
        crm: {
          name: name ?? null,
          contact: effectiveContact ?? null,
          // Los dos por separado, para que el CRM los guarde en su campo
          // correcto en vez de que el adaptador tenga que adivinar cuál es.
          email: correo?.addressRaw ?? convEmail ?? null,
          phone: telefono?.addressRaw ?? convPhone ?? null,
          intent,
          notes: notes ?? null,
          company: company ?? null,
          estimatedValue: estimatedValue ?? null,
          // La moneda la resuelve el trabajo diferido: es una consulta más y
          // aquí lo que se busca es devolver cuanto antes.
          currency: "",
        },
        aviso: {
          titulo: "Nueva oportunidad",
          resumen: `${name || effectiveContact || "Alguien"}: ${intent}`,
        },
      });

      // La empresa NO bloquea la captura (perder el lead sería peor, y un
      // cliente que no la quiere dar existe), pero sí se le recuerda al modelo
      // que la pida: sin ella la oportunidad queda sin empresa en el CRM y el
      // equipo de ventas pierde con quién está tratando. Volver a llamar la
      // tool con el dato la completa — mergeCapture rellena huecos sin pisar.
      const yaTeniaEmpresa = existing ? Boolean(leadMetadata(existing).empresa) : false;
      const faltaEmpresa = !company && !yaTeniaEmpresa;
      const base = isNew ? "Lead capturado." : "Ya teníamos este lead — se actualizó con lo nuevo.";

      return {
        leadId,
        captured: true,
        faltaEmpresa,
        message: faltaEmpresa
          ? `${base} FALTA la empresa: pregúntale desde qué empresa nos contacta y vuelve a llamar esta tool con ese dato.`
          : base,
      };
    },
  });
}

export async function pushToCrmIfConnected(
  env: Env,
  db: Db,
  botId: string,
  leadId: string,
  lead: CrmLeadInput,
): Promise<void> {
  try {
    const connector = await new BotConnectorsRepo(db).getActiveByCategory(botId, "crm");
    if (!connector) return;
    const adapter = CRM_ADAPTERS[connector.provider];
    if (!adapter) return;
    const creds = await resolveConnectorCreds(db, connector, env);
    if (!creds) return;
    const result = await adapter.pushLead(creds, lead);
    if (result.ok && result.externalId) {
      await new LeadsRepo(db, botId).setExported(leadId, connector.provider, result.externalId);
    } else if (!result.ok) {
      console.error(`[captureLead] push a ${connector.provider} falló para lead ${leadId}:`, result.error);
    }
  } catch (e) {
    console.error(`[captureLead] push al CRM falló para lead ${leadId}:`, e);
  }
}

/**
 * Mete al lead recién creado en TODAS las secuencias marcadas como
 * automáticas. Pueden ser varias: un lead puede estar en varios seguimientos
 * a la vez, y una inscripción no cancela a la otra.
 *
 * La consulta va antes que las inscripciones a propósito: sin ninguna
 * automática —el caso normal— esto es UNA consulta barata y se acaba, en vez
 * de arrancar la maquinaria para descubrir que no había nada que hacer.
 *
 * Cada una se inscribe por separado y un fallo no frena a las siguientes: que
 * una secuencia esté mal armada no puede dejar al lead fuera de las demás.
 */
export async function inscribirEnSecuenciaAutomatica(
  env: Env,
  db: Db,
  botId: string,
  leadId: string,
): Promise<void> {
  const secuencias = await new NurtureSequencesRepo(db, botId).listAutoEnroll();
  if (secuencias.length === 0) return;

  const { enrollLeadInSequence } = await import("../nurture/run");
  const entro: string[] = [];
  for (const secuencia of secuencias) {
    const r = await enrollLeadInSequence(env, botId, leadId, secuencia.id).catch((e) => ({
      ok: false as const,
      error: String((e as Error)?.message ?? e),
    }));
    if (r.ok) entro.push(secuencia.name);
    else console.warn(`[captureLead] lead ${leadId} no entró a "${secuencia.name}": ${r.error}`);
  }
  if (entro.length) {
    console.log(`[captureLead] lead ${leadId} inscrito automáticamente en: ${entro.join(", ")}`);
  }
}
