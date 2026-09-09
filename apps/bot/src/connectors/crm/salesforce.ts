// Salesforce como CRM del bot.
//
// Autenticación: OAuth 2.0 **Client Credentials** de una Connected App (o una
// External Client App) del dueño. Se eligió sobre el OAuth de tres patas —el
// de google-calendar/jira— por una razón práctica: Salesforce es un CRM de
// equipo, y lo que el bot escribe debe quedar a nombre de un usuario de
// integración, no de la persona que casualmente estaba frente al panel el día
// que lo conectó. Además evita el callback: el dueño pega instancia + clave +
// secreto una sola vez, como en HubSpot o Pipedrive, y no hay que registrarle
// una URI de redirección.
//
// Salesforce no tiene "pipelines" como HubSpot: una oportunidad solo tiene
// StageName, salido de una lista de valores. Por eso `listPipelineStages`
// devuelve etapas a secas, y el id que guarda el panel es el nombre de API de
// la etapa tal cual.
import type {
  ConnectorCreds,
  CrmConnector,
  CrmChange,
  CrmChangeResult,
  CrmCustomerSnapshot,
  CrmLeadInput,
  CrmRecord,
  ConnectorListResult,
  ConnectorPushResult,
  PipelineStageListResult,
} from "../types";
import { textoDeSeguimiento, vencimientoSeguimiento } from "../followupTask";

/**
 * Versión de la API en la URL. Fija a propósito: Salesforce mantiene cada
 * versión por años y las nuevas cambian nombres de campos — que se mueva sola
 * cuando el dueño no tocó nada es la clase de sorpresa que rompe un lunes.
 */
const API_VERSION = "v61.0";

const FALTA_URL =
  "Falta la dirección de tu Salesforce en la conexión (ej. https://miempresa.my.salesforce.com).";

function baseUrl(creds: ConnectorCreds): string | null {
  const raw = (creds.config.instanceUrl ?? "").trim().replace(/\/+$/, "");
  if (!raw) return null;
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function apiUrl(base: string, path: string): string {
  return `${base}/services/data/${API_VERSION}${path}`;
}

function isEmail(v: string): boolean {
  return /.+@.+\..+/.test(v);
}

/**
 * Escapa un valor para meterlo entre comillas simples en SOQL.
 *
 * No es adorno: el correo y el teléfono con los que se busca vienen de lo que
 * escribió una persona en una conversación. Sin esto, una comilla en un
 * correo rompe la consulta — y algo peor escrito a propósito la reescribe.
 */
function soql(valor: string): string {
  return valor.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// ── Token ─────────────────────────────────────────────────────────────────
//
// El client_credentials devuelve un access_token de vida corta. Se guarda en
// memoria del proceso mientras dure: cada alta de lead hace cuatro o cinco
// llamadas (contacto, cuenta, oportunidad, tarea) y pedir un token para cada
// una duplicaría el tráfico y la latencia. Es caché de proceso, no de base:
// perderla al reiniciar solo cuesta un token nuevo.

interface TokenVivo {
  token: string;
  vence: number;
}
const TOKENS = new Map<string, TokenVivo>();

/** Margen antes de que expire, para no mandar uno que muere en el camino. */
const MARGEN_MS = 60_000;

async function obtenerToken(creds: ConnectorCreds, base: string): Promise<{ token: string } | { error: string }> {
  const consumerKey = (creds.config.consumerKey ?? "").trim();
  if (!consumerKey) return { error: "Falta la Consumer Key de tu Connected App en la conexión." };
  if (!creds.apiKey) return { error: "Falta el Consumer Secret de tu Connected App en la conexión." };

  const llave = `${base}|${consumerKey}`;
  const vivo = TOKENS.get(llave);
  if (vivo && Date.now() < vivo.vence - MARGEN_MS) return { token: vivo.token };

  try {
    const res = await fetch(`${base}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: consumerKey,
        client_secret: creds.apiKey,
      }).toString(),
    });
    const cuerpo = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      error_description?: string;
      error?: string;
    };
    if (!res.ok || !cuerpo.access_token) {
      const detalle = cuerpo.error_description ?? cuerpo.error ?? `respondió ${res.status}`;
      // El error más común de esta configuración —y el que más confunde— es
      // no haber elegido el "Run As" de la app. Vale la pena nombrarlo.
      return {
        error: `Salesforce no dio acceso: ${detalle}. Revisa que tu Connected App tenga activado el flujo de credenciales de cliente y un usuario en "Run As".`,
      };
    }
    // Salesforce no devuelve expires_in en este flujo; la sesión dura lo que
    // diga el perfil del usuario (2 horas es lo típico). Se asume media hora,
    // que es corto y seguro: si caduca antes, la siguiente llamada da 401 y se
    // pide uno nuevo.
    TOKENS.set(llave, { token: cuerpo.access_token, vence: Date.now() + 30 * 60_000 });
    return { token: cuerpo.access_token };
  } catch (e) {
    return { error: String((e as Error)?.message ?? e) };
  }
}

/** Olvida el token de esta cuenta — tras un 401, para que el siguiente intento pida uno nuevo. */
function olvidarToken(creds: ConnectorCreds, base: string): void {
  TOKENS.delete(`${base}|${(creds.config.consumerKey ?? "").trim()}`);
}

interface Contexto {
  base: string;
  token: string;
}

async function contexto(creds: ConnectorCreds): Promise<Contexto | { error: string }> {
  const base = baseUrl(creds);
  if (!base) return { error: FALTA_URL };
  const t = await obtenerToken(creds, base);
  return "error" in t ? t : { base, token: t.token };
}

/** Una llamada a la API con el token puesto. Un 401 tira el token cacheado y reintenta UNA vez. */
async function llamar(
  creds: ConnectorCreds,
  ctx: Contexto,
  path: string,
  init: RequestInit = {},
  reintento = true,
): Promise<Response> {
  const res = await fetch(apiUrl(ctx.base, path), {
    ...init,
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401 && reintento) {
    olvidarToken(creds, ctx.base);
    const t = await obtenerToken(creds, ctx.base);
    if (!("error" in t)) return llamar(creds, { ...ctx, token: t.token }, path, init, false);
  }
  return res;
}

async function detalle(res: Response): Promise<string> {
  const texto = (await res.text()).slice(0, 300);
  // Los errores de Salesforce vienen como [{message, errorCode}] — el mensaje
  // solo es mucho más legible que el arreglo crudo.
  try {
    const parsed = JSON.parse(texto);
    if (Array.isArray(parsed) && parsed[0]?.message) return String(parsed[0].message);
  } catch {
    /* si no es JSON, se muestra tal cual */
  }
  return texto;
}

async function consultar<T>(creds: ConnectorCreds, ctx: Contexto, q: string): Promise<{ records: T[] } | { error: string }> {
  const res = await llamar(creds, ctx, `/query?q=${encodeURIComponent(q)}`);
  if (!res.ok) return { error: `Salesforce respondió ${res.status}: ${await detalle(res)}` };
  const body = (await res.json()) as { records?: T[] };
  return { records: body.records ?? [] };
}

async function crear(
  creds: ConnectorCreds,
  ctx: Contexto,
  objeto: string,
  campos: Record<string, unknown>,
): Promise<{ id: string } | { error: string }> {
  const res = await llamar(creds, ctx, `/sobjects/${objeto}`, { method: "POST", body: JSON.stringify(campos) });
  if (!res.ok) return { error: `Salesforce respondió ${res.status}: ${await detalle(res)}` };
  const body = (await res.json()) as { id?: string };
  return body.id ? { id: body.id } : { error: "Salesforce no devolvió el id del registro." };
}

/**
 * Salesforce exige `LastName` en un contacto y no acepta uno vacío.
 *
 * En una conversación real la gente da un nombre de pila y ya ("soy Ana"), o
 * ni eso. Partir el nombre y usar el resto como apellido cubre el caso normal;
 * cuando solo hay una palabra, esa palabra ES el apellido para Salesforce —
 * feo, pero deja el registro creado y con el nombre visible, que es lo que
 * importa. Sin nombre alguno, se marca explícitamente para que en el CRM se
 * vea que falta en vez de aparecer como un contacto anónimo más.
 */
function partirNombre(nombre: string | null): { FirstName?: string; LastName: string } {
  const limpio = (nombre ?? "").trim().replace(/\s+/g, " ");
  if (!limpio) return { LastName: "(sin nombre)" };
  const partes = limpio.split(" ");
  if (partes.length === 1) return { LastName: partes[0] };
  return { FirstName: partes[0], LastName: partes.slice(1).join(" ") };
}

/** Fecha de cierre estimada de la oportunidad — Salesforce la exige y no la deduce. */
function cierreEstimado(): string {
  return new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
}

/** YYYY-MM-DD, que es lo que Salesforce espera en un campo Date (no datetime). */
function soloFecha(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Campos de contacto que el agente puede proponer actualizar, traducidos al vocabulario de Salesforce. */
const CAMPOS_CONTACTO: Record<string, string> = {
  nombre: "FirstName",
  correo: "Email",
  email: "Email",
  telefono: "Phone",
  teléfono: "Phone",
  cargo: "Title",
  puesto: "Title",
  notas: "Description",
};

/** Lo mismo para la cuenta (la "empresa" de Salesforce). */
const CAMPOS_EMPRESA: Record<string, string> = {
  nombre: "Name",
  industria: "Industry",
  sitio: "Website",
  web: "Website",
  telefono: "Phone",
  teléfono: "Phone",
};

/** Busca a la persona por correo o teléfono. Devuelve el Id o null. */
async function buscarContacto(
  creds: ConnectorCreds,
  ctx: Contexto,
  buscarPor: { email?: string | null; telefono?: string | null },
): Promise<string | null> {
  const correo = (buscarPor.email ?? "").trim();
  const telefono = (buscarPor.telefono ?? "").trim();

  if (correo) {
    const r = await consultar<{ Id: string }>(
      creds,
      ctx,
      `SELECT Id FROM Contact WHERE Email = '${soql(correo)}' LIMIT 1`,
    );
    if (!("error" in r) && r.records[0]) return r.records[0].Id;
  }
  if (telefono) {
    // Los teléfonos se guardan con formato libre ("55 1234 5678", "+525512345678"),
    // así que una igualdad exacta casi nunca acierta. Se comparan los últimos
    // dígitos, que es lo que de verdad identifica a la línea.
    const digitos = telefono.replace(/\D/g, "").slice(-10);
    if (digitos.length >= 7) {
      const r = await consultar<{ Id: string }>(
        creds,
        ctx,
        `SELECT Id FROM Contact WHERE Phone LIKE '%${soql(digitos)}%' OR MobilePhone LIKE '%${soql(digitos)}%' LIMIT 1`,
      );
      if (!("error" in r) && r.records[0]) return r.records[0].Id;
    }
  }
  return null;
}

export const salesforceConnector: CrmConnector = {
  async pushLead(creds: ConnectorCreds, lead: CrmLeadInput): Promise<ConnectorPushResult> {
    const ctx = await contexto(creds);
    if ("error" in ctx) return { ok: false, error: ctx.error };

    const correo = lead.email ?? (lead.contact && isEmail(lead.contact) ? lead.contact : null);
    const telefono = lead.phone ?? (lead.contact && !isEmail(lead.contact) ? lead.contact : null);

    // Si ya está en el CRM se reusa: dar de alta el mismo contacto dos veces
    // le rompe los reportes a quien vive de ese CRM.
    let contactId = await buscarContacto(creds, ctx, { email: correo, telefono });

    // La cuenta primero, para poder colgarle el contacto desde el alta.
    let accountId: string | undefined;
    if (lead.company) {
      const existente = await consultar<{ Id: string }>(
        creds,
        ctx,
        `SELECT Id FROM Account WHERE Name = '${soql(lead.company)}' LIMIT 1`,
      );
      if (!("error" in existente) && existente.records[0]) {
        accountId = existente.records[0].Id;
      } else {
        const nueva = await crear(creds, ctx, "Account", { Name: lead.company });
        if ("id" in nueva) accountId = nueva.id;
        else console.error(`[salesforce] no se pudo crear la cuenta: ${nueva.error}`);
      }
    }

    if (!contactId) {
      const descripcion = [lead.intent, lead.notes].filter(Boolean).join("\n\n");
      const nuevo = await crear(creds, ctx, "Contact", {
        ...partirNombre(lead.name),
        ...(correo ? { Email: correo } : {}),
        ...(telefono ? { Phone: telefono } : {}),
        ...(descripcion ? { Description: descripcion.slice(0, 32_000) } : {}),
        ...(accountId ? { AccountId: accountId } : {}),
      });
      if ("error" in nuevo) return { ok: false, error: nuevo.error };
      contactId = nuevo.id;
    }

    // Oportunidad y tarea: best-effort. El contacto ya quedó, y perderlo por
    // un fallo de lo secundario sería el peor de los dos resultados.
    try {
      const etapa = (creds.config.pipelineStage ?? "").trim();
      if (etapa) {
        const nombre = `${lead.name || lead.contact || "Lead"} — ${lead.intent}`.slice(0, 120);
        const opp = await crear(creds, ctx, "Opportunity", {
          Name: nombre,
          StageName: etapa,
          CloseDate: cierreEstimado(),
          ...(accountId ? { AccountId: accountId } : {}),
          ...(lead.estimatedValue ? { Amount: lead.estimatedValue } : {}),
        });
        if ("id" in opp) {
          // La oportunidad y el contacto se ligan por OpportunityContactRole;
          // sin esto, el vendedor abre la oportunidad y no sabe a quién llamar.
          const rol = await crear(creds, ctx, "OpportunityContactRole", {
            OpportunityId: opp.id,
            ContactId: contactId,
            IsPrimary: true,
          });
          if ("error" in rol) console.error(`[salesforce] no se pudo ligar el contacto a la oportunidad: ${rol.error}`);
        } else {
          console.error(`[salesforce] no se pudo crear la oportunidad: ${opp.error}`);
        }
      }

      const tarea = await crear(creds, ctx, "Task", {
        Subject: textoDeSeguimiento(lead),
        Description: [lead.intent, lead.notes].filter(Boolean).join("\n\n"),
        WhoId: contactId,
        Status: "Not Started",
        Priority: "Normal",
        ActivityDate: soloFecha(vencimientoSeguimiento(creds)),
      });
      if ("error" in tarea) console.error(`[salesforce] no se pudo crear la tarea: ${tarea.error}`);
    } catch (e) {
      console.error("[salesforce] cuenta/oportunidad/tarea falló (el contacto ya quedó creado):", e);
    }

    return { ok: true, externalId: contactId };
  },

  async listRecent(creds: ConnectorCreds, limit: number): Promise<ConnectorListResult<CrmRecord>> {
    const ctx = await contexto(creds);
    if ("error" in ctx) return { ok: false, items: [], error: ctx.error };

    const tope = Math.max(1, Math.min(200, Math.trunc(limit)));
    const r = await consultar<{ Id: string; Name: string | null; Email: string | null; Phone: string | null; CreatedDate: string }>(
      creds,
      ctx,
      `SELECT Id, Name, Email, Phone, CreatedDate FROM Contact ORDER BY CreatedDate DESC LIMIT ${tope}`,
    );
    if ("error" in r) return { ok: false, items: [], error: r.error };

    return {
      ok: true,
      items: r.records.map((c) => ({
        id: c.Id,
        name: c.Name?.trim() || "(sin nombre)",
        contact: c.Email ?? c.Phone ?? "—",
        createdAt: new Date(c.CreatedDate).getTime(),
        url: `${ctx.base}/lightning/r/Contact/${c.Id}/view`,
      })),
    };
  },

  /**
   * Las etapas reales de la organización, no una lista escrita a mano.
   *
   * Salesforce las expone en el describe de Opportunity, y cada empresa
   * renombra las suyas — pedirle al dueño que teclee "Value Proposition"
   * exacto sería el mismo error que ya se cometió con Vinqulia, donde la
   * oportunidad quedaba guardada en una etapa que su tablero no dibujaba.
   */
  async listPipelineStages(creds: ConnectorCreds): Promise<PipelineStageListResult> {
    const ctx = await contexto(creds);
    if ("error" in ctx) return { ok: false, items: [], error: ctx.error };

    const res = await llamar(creds, ctx, "/sobjects/Opportunity/describe");
    if (!res.ok) return { ok: false, items: [], error: `Salesforce respondió ${res.status}: ${await detalle(res)}` };

    const body = (await res.json()) as {
      fields?: Array<{ name: string; picklistValues?: Array<{ value: string; label: string; active: boolean }> }>;
    };
    const etapas = body.fields?.find((f) => f.name === "StageName")?.picklistValues ?? [];
    return {
      ok: true,
      items: etapas.filter((e) => e.active).map((e) => ({ id: e.value, label: e.label })),
    };
  },

  async lookupCustomer(
    creds: ConnectorCreds,
    buscarPor: { email?: string | null; telefono?: string | null },
  ): Promise<CrmCustomerSnapshot | null> {
    const ctx = await contexto(creds);
    if ("error" in ctx) return null;

    const contactId = await buscarContacto(creds, ctx, buscarPor);
    if (!contactId) return null;

    const ficha = await consultar<{
      Id: string;
      Name: string | null;
      Title: string | null;
      AccountId: string | null;
      Account: { Name: string | null; Industry: string | null; NumberOfEmployees: number | null } | null;
    }>(
      creds,
      ctx,
      `SELECT Id, Name, Title, AccountId, Account.Name, Account.Industry, Account.NumberOfEmployees FROM Contact WHERE Id = '${soql(contactId)}' LIMIT 1`,
    );
    if ("error" in ficha || !ficha.records[0]) return null;
    const c = ficha.records[0];

    const snapshot: CrmCustomerSnapshot = {
      contactId,
      ...(c.Name ? { nombre: c.Name } : {}),
      ...(c.Title ? { cargo: c.Title } : {}),
      ...(c.AccountId && c.Account?.Name
        ? {
            empresa: {
              id: c.AccountId,
              nombre: c.Account.Name,
              ...(c.Account.Industry ? { industria: c.Account.Industry } : {}),
              ...(c.Account.NumberOfEmployees ? { tamano: c.Account.NumberOfEmployees } : {}),
            },
          }
        : {}),
      oportunidades: [],
      notasRecientes: [],
      url: `${ctx.base}/lightning/r/Contact/${contactId}/view`,
    };

    // Oportunidades y notas en paralelo: son dos viajes independientes y esto
    // corre mientras el cliente espera (ver customer/crmSnapshot.ts).
    const [opps, tareas] = await Promise.all([
      consultar<{ Id: string; Name: string; StageName: string | null; Amount: number | null; CloseDate: string | null }>(
        creds,
        ctx,
        `SELECT Id, Name, StageName, Amount, CloseDate FROM Opportunity
          WHERE Id IN (SELECT OpportunityId FROM OpportunityContactRole WHERE ContactId = '${soql(contactId)}')
          ORDER BY CreatedDate DESC LIMIT 5`,
      ),
      consultar<{ Subject: string | null; Description: string | null; ActivityDate: string | null; CreatedDate: string }>(
        creds,
        ctx,
        `SELECT Subject, Description, ActivityDate, CreatedDate FROM Task
          WHERE WhoId = '${soql(contactId)}' ORDER BY CreatedDate DESC LIMIT 5`,
      ),
    ]);

    if (!("error" in opps)) {
      snapshot.oportunidades = opps.records.map((o) => ({
        id: o.Id,
        nombre: o.Name,
        ...(o.StageName ? { etapa: o.StageName } : {}),
        ...(o.Amount != null ? { monto: o.Amount } : {}),
        ...(o.CloseDate ? { cierreEstimado: o.CloseDate } : {}),
      }));
    }
    if (!("error" in tareas)) {
      snapshot.notasRecientes = tareas.records
        .map((t) => ({
          fecha: (t.ActivityDate ?? t.CreatedDate)?.slice(0, 10),
          texto: [t.Subject, t.Description].filter(Boolean).join(" — ").slice(0, 500),
        }))
        .filter((n) => n.texto);
    }
    return snapshot;
  },

  sabeAplicarCambio(cambio) {
    if (cambio.operation === "revisar_contradiccion") return true; // no toca el CRM
    if (cambio.kind === "nota" || cambio.kind === "tarea") return true;
    const campo = String(cambio.payload?.campo ?? "");
    if (cambio.kind === "contacto") return campo in CAMPOS_CONTACTO;
    if (cambio.kind === "empresa") return campo in CAMPOS_EMPRESA;
    // Salesforce no tiene etiquetas: los "topics" son otra cosa y exigen
    // permisos aparte. Decir que no aquí evita que el analizador gaste una
    // llamada al LLM proponiendo algo que nunca se va a poder escribir.
    return false;
  },

  async aplicarCambio(creds: ConnectorCreds, cambio: CrmChange): Promise<CrmChangeResult> {
    if (cambio.operation === "revisar_contradiccion") {
      return { ok: true, detalle: "Anotado para revisión — no requiere cambios en Salesforce." };
    }
    const ctx = await contexto(creds);
    if ("error" in ctx) return { ok: false, detalle: ctx.error };

    const contactId =
      cambio.contacto.idEnCrm ??
      (await buscarContacto(creds, ctx, {
        email: cambio.contacto.dato && isEmail(cambio.contacto.dato) ? cambio.contacto.dato : null,
        telefono: cambio.contacto.dato && !isEmail(cambio.contacto.dato) ? cambio.contacto.dato : null,
      }));
    if (!contactId) {
      return { ok: false, detalle: "No se encontró a esta persona en Salesforce. Regístrala primero." };
    }

    const payload = cambio.payload;

    if (cambio.kind === "nota") {
      // Como Task ya cerrada y no como Note: las Notes de Salesforce cuelgan
      // de ContentDocument (subida en dos pasos, con permisos propios), y una
      // actividad completada sale en la cronología del contacto, que es
      // exactamente donde el vendedor la va a buscar.
      const texto = String(payload.texto ?? cambio.valorPropuesto ?? "").trim();
      if (!texto) return { ok: false, detalle: "La nota venía vacía." };
      const r = await crear(creds, ctx, "Task", {
        Subject: texto.slice(0, 100),
        Description: texto.slice(0, 32_000),
        WhoId: contactId,
        Status: "Completed",
        ActivityDate: soloFecha(new Date()),
      });
      return "id" in r ? { ok: true, detalle: "Nota registrada en Salesforce." } : { ok: false, detalle: r.error };
    }

    if (cambio.kind === "tarea") {
      const texto = String(payload.texto ?? cambio.valorPropuesto ?? "").trim();
      if (!texto) return { ok: false, detalle: "La tarea venía sin descripción." };
      // Sin vencimiento a propósito cuando no se conoce el instante: el
      // analizador propone tareas a partir de frases ambiguas ("el martes"),
      // y una fecha inventada es peor que ninguna.
      const vence = payload.venceIso ? String(payload.venceIso) : null;
      const r = await crear(creds, ctx, "Task", {
        Subject: texto.slice(0, 100),
        Description: texto.slice(0, 32_000),
        WhoId: contactId,
        Status: "Not Started",
        Priority: "Normal",
        ...(vence ? { ActivityDate: vence.slice(0, 10) } : {}),
      });
      return "id" in r ? { ok: true, detalle: "Tarea creada en Salesforce." } : { ok: false, detalle: r.error };
    }

    const valor = String(payload.valor ?? cambio.valorPropuesto ?? "").trim();
    if (!valor) return { ok: false, detalle: "El cambio venía sin valor." };
    const campo = String(payload.campo ?? "");

    if (cambio.kind === "contacto") {
      const sfCampo = CAMPOS_CONTACTO[campo];
      if (!sfCampo) return { ok: false, detalle: `Salesforce no tiene un campo para "${campo}".` };
      const res = await llamar(creds, ctx, `/sobjects/Contact/${contactId}`, {
        method: "PATCH",
        body: JSON.stringify({ [sfCampo]: valor }),
      });
      return res.ok
        ? { ok: true, detalle: `${campo} actualizado en Salesforce.` }
        : { ok: false, detalle: await detalle(res) };
    }

    if (cambio.kind === "empresa") {
      const sfCampo = CAMPOS_EMPRESA[campo];
      if (!sfCampo) return { ok: false, detalle: `Salesforce no tiene un campo de cuenta para "${campo}".` };
      let accountId = cambio.empresaIdEnCrm;
      if (!accountId) {
        const r = await consultar<{ AccountId: string | null }>(
          creds,
          ctx,
          `SELECT AccountId FROM Contact WHERE Id = '${soql(contactId)}' LIMIT 1`,
        );
        if (!("error" in r)) accountId = r.records[0]?.AccountId ?? undefined;
      }
      if (!accountId) return { ok: false, detalle: "Esta persona no tiene una cuenta ligada en Salesforce." };
      const res = await llamar(creds, ctx, `/sobjects/Account/${accountId}`, {
        method: "PATCH",
        body: JSON.stringify({ [sfCampo]: valor }),
      });
      return res.ok
        ? { ok: true, detalle: `${campo} de la empresa actualizado en Salesforce.` }
        : { ok: false, detalle: await detalle(res) };
    }

    return { ok: false, detalle: `Salesforce no sabe aplicar cambios de tipo "${cambio.kind}".` };
  },
};
