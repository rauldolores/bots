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
import { notifyOwner } from "./handoffHuman";
import { registerLeadContacts } from "../contacts/register";
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

      // Si el dueño marcó una secuencia como automática, el lead entra solo —
      // que era el punto: nadie va a abrir el detalle de cada lead para
      // asignársela a mano.
      //
      // SOLO para leads nuevos. En el camino de fusión (un lead que ya
      // existía y vuelve a escribir) volver a inscribirlo lo regresaría al
      // paso 0 cada vez, y la misma persona recibiría el primer mensaje de la
      // secuencia una y otra vez.
      //
      // Best-effort: que falle no puede tumbar la captura del lead, que es lo
      // que de verdad no se puede perder.
      if (isNew) {
        await inscribirEnSecuenciaAutomatica(env, db, botId, leadId).catch((e) =>
          console.error("[captureLead] no se pudo inscribir en la secuencia automática:", e),
        );
      }

      // El lead SIEMPRE queda local primero (es la fuente interna — conserva
      // el link a la conversación y no depende de que el CRM esté disponible).
      // Si hay un CRM conectado, además se empuja ahí, best-effort: si falla,
      // el lead no se pierde, solo no llegó todavía al CRM del cliente. Si ya
      // se había exportado (es el lead existente reencontrado), no se vuelve
      // a empujar — evitaría crear un segundo registro duplicado allá.
      if (isNew || !existing?.exported_to) {
        const bot = await new BotsRepo(db).getById(botId);
        await pushToCrmIfConnected(env, db, botId, leadId, {
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
          currency: bot?.config.currency || "MXN",
        });
      }

      // Avisarle al dueño, igual que ya lo hace un ticket. Desde que una
      // cotización se registra como oportunidad y NO como ticket (ver
      // <que_registrar> en system-prompt.ts), sin esto un lead caliente
      // entraría al CRM en silencio. Solo en altas nuevas: si el mismo cliente
      // sigue escribiendo, ya se avisó. Best-effort, nunca tumba la captura.
      if (isNew) {
        await notifyOwner(
          env,
          {
            reason: "nueva oportunidad",
            summary: `${name || effectiveContact || "Alguien"}: ${intent}`,
            ticketId: leadId,
            titulo: "Nueva oportunidad",
            ruta: "/admin/leads",
          },
          botId,
        ).catch((e) => console.error("[captureLead] no se pudo avisar al dueño:", e));
      }

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

async function pushToCrmIfConnected(
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
 * Mete al lead recién creado en la secuencia que el dueño marcó como
 * automática, si hay una.
 *
 * La consulta va antes que la inscripción a propósito: sin secuencia
 * automática —el caso normal— esto es UNA consulta barata y se acaba, en vez
 * de arrancar la maquinaria de inscripción para descubrir que no había nada
 * que hacer.
 */
async function inscribirEnSecuenciaAutomatica(
  env: Env,
  db: Db,
  botId: string,
  leadId: string,
): Promise<void> {
  const secuencia = await new NurtureSequencesRepo(db, botId).getAutoEnroll();
  if (!secuencia) return;

  const { enrollLeadInSequence } = await import("../nurture/run");
  const r = await enrollLeadInSequence(env, botId, leadId, secuencia.id);
  if (!r.ok) {
    console.warn(`[captureLead] lead ${leadId} no entró a "${secuencia.name}": ${r.error}`);
    return;
  }
  console.log(`[captureLead] lead ${leadId} inscrito automáticamente en "${secuencia.name}"`);
}
