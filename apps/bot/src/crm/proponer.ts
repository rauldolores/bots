/**
 * De "qué aprendí" a "qué propongo hacer".
 *
 * Aquí vive el criterio, y por eso está en código y no en el prompt: qué se
 * propone, con qué riesgo, y —sobre todo— qué NO se propone. Un modelo puede
 * decir qué entendió; no puede garantizar que no va a proponer lo mismo tres
 * veces ni que no va a pisar un dato bueno con uno peor.
 *
 * Nada de lo que sale de aquí se ejecuta: todo va a la cola de revisión.
 */
import type { Db } from "../db/client";
import { CrmProposalsRepo, type ProposalRisk } from "../db/crmProposals";
import type { CustomerContext } from "../customer/context";
import type { AnalisisCrm } from "./analizar";

/**
 * Riesgo por tipo de cambio, NO por confianza del modelo.
 *
 * La confianza que declara un modelo es notoriamente mala (dice 0.9 de casi
 * todo). Lo que sí es verificable es la CONSECUENCIA: rellenar un campo vacío
 * no se parece en nada a mover una etapa o cerrar un ticket.
 */
const RIESGO: Record<string, ProposalRisk> = {
  "nota:crear": "bajo",
  "etiqueta:agregar": "bajo",
  "contacto:completar": "bajo", // rellenar un hueco
  "empresa:completar": "bajo",
  "contacto:corregir": "medio", // pisar un valor existente
  "empresa:corregir": "medio",
  "tarea:crear": "medio",
  "oportunidad:mover_etapa": "alto",
  "ticket:cerrar": "alto",
};

function riesgoDe(kind: string, operation: string): ProposalRisk {
  return RIESGO[`${kind}:${operation}`] ?? "alto"; // lo desconocido se trata como delicado
}

export interface EntradaPropuestas {
  analisis: AnalisisCrm;
  conversationId: string;
  cliente: CustomerContext;
}

/**
 * Encola lo que valga la pena de un análisis. Devuelve cuántas propuestas
 * NUEVAS quedaron (las repetidas no cuentan: el anti-duplicados las descarta).
 */
export async function proponerDesdeAnalisis(
  db: Db,
  botId: string,
  { analisis, conversationId, cliente }: EntradaPropuestas,
): Promise<number> {
  const repo = new CrmProposalsRepo(db, botId);
  const leadId = cliente.lead?.id ?? null;
  const crm = cliente.crm;
  let creadas = 0;

  const encolar = async (p: Parameters<CrmProposalsRepo["propose"]>[0]) => {
    const id = await repo.propose(p).catch((e) => {
      console.error("[crmProponer] no se pudo encolar:", e);
      return null;
    });
    if (id) creadas++;
  };

  // El resumen SIEMPRE vale: es la memoria que hoy solo existe en la cabeza de
  // quien atendió. Se ancla a la conversación para que no se encole dos veces
  // aunque el análisis se repita.
  if (analisis.interaccion?.resumen?.trim()) {
    await encolar({
      conversationId,
      leadId,
      kind: "nota",
      operation: "crear",
      summary: `Nota de la conversación: ${recortar(analisis.interaccion.resumen, 90)}`,
      payload: { texto: analisis.interaccion.resumen, intencion: analisis.interaccion.intencion },
      proposedValue: analisis.interaccion.resumen,
      reason: `Conversación de tipo "${analisis.interaccion.intencion}".`,
      confidence: 0.9,
      risk: riesgoDe("nota", "crear"),
      dedupeKey: `nota:${conversationId}`,
    });
  }

  // Datos del contacto y de la empresa: solo lo que NO sabíamos, o lo que
  // contradice lo guardado. Reescribir un dato con el mismo dato es ruido.
  await proponerCampo(encolar, {
    kind: "contacto", campo: "cargo", nuevo: analisis.contacto?.cargo, actual: crm?.cargo,
    leadId, conversationId, etiqueta: "Puesto del contacto",
  });
  await proponerCampo(encolar, {
    kind: "empresa", campo: "industria", nuevo: analisis.empresa?.industria, actual: crm?.empresa?.industria,
    leadId, conversationId, etiqueta: "Industria de la empresa",
  });
  await proponerCampo(encolar, {
    kind: "empresa", campo: "nombre", nuevo: analisis.empresa?.nombre, actual: crm?.empresa?.nombre,
    leadId, conversationId, etiqueta: "Empresa",
  });
  await proponerCampo(encolar, {
    kind: "empresa", campo: "tamano",
    nuevo: analisis.empresa?.tamano != null ? String(analisis.empresa.tamano) : undefined,
    actual: crm?.empresa?.tamano != null ? String(crm.empresa.tamano) : undefined,
    leadId, conversationId, etiqueta: "Tamaño de la empresa",
  });

  // Compromisos → tareas. Solo los nuestros: lo que el cliente prometió no es
  // trabajo para nadie del equipo.
  for (const c of analisis.compromisos ?? []) {
    if (c.deQuien !== "nosotros") continue;
    await encolar({
      conversationId,
      leadId,
      kind: "tarea",
      operation: "crear",
      summary: `Tarea: ${recortar(c.que, 70)}${c.cuando ? ` (${c.cuando})` : ""}`,
      payload: { texto: c.que, cuando: c.cuando ?? null },
      proposedValue: [c.que, c.cuando].filter(Boolean).join(" — "),
      reason: "Se comprometió a esto durante la conversación.",
      confidence: 0.8,
      risk: riesgoDe("tarea", "crear"),
      // Por compromiso, no por conversación: dos promesas distintas en el mismo
      // chat son dos tareas.
      dedupeKey: `tarea:${conversationId}:${normalizar(c.que)}`,
    });
  }

  for (const etiqueta of (analisis.etiquetas ?? []).slice(0, 4)) {
    const limpia = normalizar(etiqueta);
    if (!limpia) continue;
    await encolar({
      conversationId,
      leadId,
      kind: "etiqueta",
      operation: "agregar",
      summary: `Etiquetar como "${limpia}"`,
      payload: { etiqueta: limpia },
      proposedValue: limpia,
      reason: "Detectada en la conversación.",
      confidence: 0.7,
      risk: riesgoDe("etiqueta", "agregar"),
      // Por lead, no por conversación: la misma etiqueta en diez chats es UNA
      // etiqueta, y proponerla diez veces vuelve la cola inservible.
      dedupeKey: `etiqueta:${leadId ?? conversationId}:${limpia}`,
    });
  }

  // Las contradicciones NO se proponen como cambio: se dejan como aviso para
  // que una persona decida. Es la diferencia entre "actualicé su presupuesto"
  // y "ojo, dijo otra cifra".
  for (const c of analisis.contradicciones ?? []) {
    await encolar({
      conversationId,
      leadId,
      kind: "contacto",
      operation: "revisar_contradiccion",
      summary: `Contradicción en ${c.campo}: dijo "${recortar(c.loQueDijo, 60)}"`,
      payload: { campo: c.campo, loQueDijo: c.loQueDijo },
      proposedValue: c.loQueDijo,
      reason: "Lo que dijo no coincide con lo registrado. Nadie lo cambió — decídelo tú.",
      confidence: 0.5,
      risk: "alto",
      dedupeKey: `contradiccion:${conversationId}:${normalizar(c.campo)}`,
    });
  }

  return creadas;
}

/** Un campo suelto: se propone si es nuevo, o si contradice lo guardado. Nunca si es lo mismo. */
async function proponerCampo(
  encolar: (p: Parameters<CrmProposalsRepo["propose"]>[0]) => Promise<void>,
  o: {
    kind: "contacto" | "empresa";
    campo: string;
    nuevo: string | undefined;
    actual: string | undefined;
    leadId: string | null;
    conversationId: string;
    etiqueta: string;
  },
): Promise<void> {
  const nuevo = o.nuevo?.trim();
  if (!nuevo) return;
  if (o.actual && normalizar(o.actual) === normalizar(nuevo)) return; // ya lo sabíamos

  const corrige = Boolean(o.actual);
  await encolar({
    conversationId: o.conversationId,
    leadId: o.leadId,
    kind: o.kind,
    operation: corrige ? "corregir" : "completar",
    summary: corrige
      ? `${o.etiqueta}: cambiar de "${recortar(o.actual!, 40)}" a "${recortar(nuevo, 40)}"`
      : `${o.etiqueta}: ${recortar(nuevo, 60)}`,
    payload: { campo: o.campo, valor: nuevo },
    currentValue: o.actual ?? null,
    proposedValue: nuevo,
    reason: corrige
      ? "Lo dicho en la conversación no coincide con lo registrado."
      : "Estaba vacío y lo mencionó en la conversación.",
    confidence: corrige ? 0.6 : 0.85,
    risk: corrige ? "medio" : "bajo",
    // Por campo y lead: si lo repite mañana, sigue siendo la misma propuesta.
    dedupeKey: `${o.kind}:${o.campo}:${o.leadId ?? o.conversationId}:${normalizar(nuevo)}`,
  });
}

function normalizar(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function recortar(v: string, n: number): string {
  const t = v.trim().replace(/\s+/g, " ");
  return t.length > n ? `${t.slice(0, n)}…` : t;
}
