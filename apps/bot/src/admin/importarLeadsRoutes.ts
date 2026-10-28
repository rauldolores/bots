// Rutas del asistente "Importar contactos" (/admin/leads/importar). Todas
// piden leads.administrar: importar escribe leads igual que cambiar su estado.
//
//   GET  /leads/importar                 1. subir archivo (+ historial)
//   POST /leads/importar                    lee el archivo → borrador
//   GET  /leads/importar/plantilla          plantilla en Excel
//   GET  /leads/importar/:id             2. columnas (o 4. listo, si ya se importó)
//   POST /leads/importar/:id/ia             sugerir columnas con IA
//   POST /leads/importar/:id/columnas       guarda el mapeo → revisión
//   POST /leads/importar/:id/descartar
//   GET  /leads/importar/:id/revision    3. revisión en seco
//   GET  /leads/importar/:id/errores        filas con error, en Excel
//   POST /leads/importar/:id/importar       importa → listo
//   POST /leads/importar/:id/deshacer
import type { Context, Hono } from "hono";
import type { AdminBindings } from "./tenantContext";
import { requirePermission, visibleNavIds } from "./permissions";
import { Db } from "../db/client";
import { BotsRepo } from "../db/bots";
import { BotConnectorsRepo } from "../db/botConnectors";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";
import { LeadImportsRepo, type LeadImport } from "../db/leadImports";
import { getNiche } from "../niches";
import { CRM_PROVIDERS } from "../connectors/registry";
import { resolveTimezone } from "../datetime";
import { ErrorDeArchivo, leerTabla, type Tabla } from "../contacts/hojas";
import {
  adivinarMapeo,
  aplicarImportacion,
  camposDeImportacion,
  deshacerImportacion,
  firmaDe,
  revisarImportacion,
  sanearMapeo,
} from "../contacts/importar";
import { sugerirMapeoConIa } from "../contacts/importarIa";
import { respuestaExport, type Columna } from "./exportar";
import {
  renderImportarColumnas,
  renderImportarInicio,
  renderImportarResultado,
  renderImportarRevision,
} from "./views/importarLeads";

/** Vercel no deja pasar cuerpos de más de 4.5 MB; con 3 MB hay margen y caben 5,000 contactos de sobra. */
const MAX_BYTES = 3 * 1024 * 1024;

export function registrarRutasDeImportar(app: Hono<AdminBindings>): void {
  const base = "/leads/importar";

  // Lo que todas las pantallas necesitan; null si no tiene permiso.
  async function contexto(c: Context<AdminBindings>) {
    const denied = requirePermission(c, "nodia-agents.leads.administrar");
    if (denied) return { denied } as const;
    const db = new Db(c.env.DB);
    const botId = c.get("botId");
    const bot = await new BotsRepo(db).getById(botId);
    const niche = getNiche(bot?.niche);
    return {
      denied: null,
      db,
      botId,
      niche,
      campos: camposDeImportacion(niche),
      repo: new LeadImportsRepo(db, botId),
      nav: visibleNavIds(c.get("kontroliaClaims")),
    } as const;
  }

  app.get(base, async (c) => {
    const x = await contexto(c);
    if (x.denied) return x.denied;
    const timezone = resolveTimezone(await new SettingsRepo(x.db, x.botId).get(SETTING_KEYS.timezone));
    const aviso = c.req.query("deshecha");
    return c.html(
      renderImportarInicio({
        niche: x.niche,
        visibleNavIds: x.nav,
        historial: await x.repo.historial(),
        timezone,
        error: c.req.query("error") ?? undefined,
        aviso: aviso !== undefined ? aviso : undefined,
      }),
    );
  });

  app.get(`${base}/plantilla`, async (c) => {
    const x = await contexto(c);
    if (x.denied) return x.denied;
    const ejemplo: Record<string, string> = { nombre: "Ana López", telefono: "33 1234 5678", correo: "ana@ejemplo.com", empresa: "", interes: "", notas: "La conocí en la feria" };
    const cols: Columna<null>[] = x.campos.map((campo) => ({ titulo: campo.etiqueta.replace(" / WhatsApp", ""), valor: () => ejemplo[campo.id] ?? "" }));
    return respuestaExport("xlsx", "plantilla-contactos.xlsx", cols, [null], { hoja: "Contactos" });
  });

  app.post(base, async (c) => {
    const x = await contexto(c);
    if (x.denied) return x.denied;
    const volver = (error: string) => c.redirect(`/admin${base}?error=${encodeURIComponent(error)}`);
    const largo = Number(c.req.header("content-length") ?? 0);
    if (largo > MAX_BYTES + 64 * 1024) return volver("El archivo pesa más de 3 MB. Quítale columnas que no sean de contactos o pártelo en varios.");
    let tabla: Tabla;
    let archivo: string;
    try {
      const form = await c.req.formData();
      const f = form.get("archivo");
      if (!f || typeof f === "string" || f.size === 0) return volver("Elige un archivo para subir.");
      if (f.size > MAX_BYTES) return volver("El archivo pesa más de 3 MB. Quítale columnas que no sean de contactos o pártelo en varios.");
      archivo = f.name.slice(0, 120) || "archivo";
      tabla = leerTabla(archivo, new Uint8Array(await f.arrayBuffer()));
    } catch (e) {
      if (e instanceof ErrorDeArchivo) return volver(e.message);
      console.error("[importar] no se pudo leer:", e);
      return volver("No se pudo leer el archivo. Revisa que sea un Excel (.xlsx) o un CSV.");
    }
    const id = await x.repo.crearBorrador({
      archivo,
      firma: firmaDe(tabla.encabezados),
      tabla,
      creadoPor: c.get("kontroliaClaims")?.email ?? null,
    });
    return c.redirect(`/admin${base}/${id}`);
  });

  // Un borrador (con su tabla) o, si ya no lo es, la pantalla que le toca.
  type Borrador = { ok: true; imp: LeadImport; tabla: Tabla } | { ok: false; ir: string };
  async function borrador(x: { repo: LeadImportsRepo }, id: string): Promise<Borrador> {
    const imp = await x.repo.get(id);
    if (!imp) return { ok: false, ir: `/admin${base}` };
    if (imp.estado !== "borrador") return { ok: false, ir: `/admin${base}/${id}` };
    const tabla = x.repo.tabla(imp);
    if (!tabla) return { ok: false, ir: `/admin${base}` };
    return { ok: true, imp, tabla };
  }

  app.get(`${base}/:id`, async (c) => {
    const x = await contexto(c);
    if (x.denied) return x.denied;
    const imp = await x.repo.get(c.req.param("id"));
    if (!imp) return c.redirect(`/admin${base}`);
    if (imp.estado !== "borrador") return c.html(renderImportarResultado({ niche: x.niche, visibleNavIds: x.nav, imp }));
    const tabla = x.repo.tabla(imp);
    if (!tabla) return c.redirect(`/admin${base}`);

    let origen: "adivinado" | "anterior" | "ia" | "guardado" = "guardado";
    let mapeo = imp.mapeo ? sanearMapeo(JSON.parse(imp.mapeo), tabla.encabezados, x.campos) : null;
    if (mapeo && c.req.query("ia") === "1") origen = "ia";
    if (!mapeo) {
      const anterior = await x.repo.mapeoAnterior(imp.firma, imp.id);
      mapeo = anterior ? sanearMapeo(anterior, tabla.encabezados, x.campos) : adivinarMapeo(tabla.encabezados, x.campos);
      origen = anterior ? "anterior" : "adivinado";
    }
    return c.html(
      renderImportarColumnas({
        niche: x.niche,
        visibleNavIds: x.nav,
        imp,
        tabla,
        campos: x.campos,
        mapeo,
        origen,
        iaDisponible: true,
        error: c.req.query("error") ?? undefined,
      }),
    );
  });

  app.post(`${base}/:id/ia`, async (c) => {
    const x = await contexto(c);
    if (x.denied) return x.denied;
    const b = await borrador(x, c.req.param("id"));
    if (!b.ok) return c.redirect(b.ir);
    try {
      const mapeo = await sugerirMapeoConIa(c.env, x.botId, b.tabla, x.campos);
      await x.repo.guardarMapeo(b.imp.id, mapeo, b.imp.consentimiento);
      return c.redirect(`/admin${base}/${b.imp.id}?ia=1`);
    } catch (e) {
      console.error("[importar] sugerencia con IA falló:", e);
      return c.redirect(`/admin${base}/${b.imp.id}?error=${encodeURIComponent("La IA no pudo sugerir las columnas ahorita. Elígelas a mano.")}`);
    }
  });

  app.post(`${base}/:id/columnas`, async (c) => {
    const x = await contexto(c);
    if (x.denied) return x.denied;
    const b = await borrador(x, c.req.param("id"));
    if (!b.ok) return c.redirect(b.ir);
    const form = await c.req.formData();
    const mapeo = sanearMapeo(
      b.tabla.encabezados.map((_, i) => form.get(`col_${i}`)),
      b.tabla.encabezados,
      x.campos,
    );
    await x.repo.guardarMapeo(b.imp.id, mapeo, form.get("consentimiento") === "1");
    if (!mapeo.includes("telefono") && !mapeo.includes("correo")) {
      return c.redirect(`/admin${base}/${b.imp.id}?error=${encodeURIComponent("Falta la columna del teléfono o del correo")}`);
    }
    return c.redirect(`/admin${base}/${b.imp.id}/revision`);
  });

  app.post(`${base}/:id/descartar`, async (c) => {
    const x = await contexto(c);
    if (x.denied) return x.denied;
    await x.repo.descartar(c.req.param("id"));
    return c.redirect(`/admin${base}`);
  });

  async function crmConectado(db: Db, botId: string): Promise<string | null> {
    const crm = await new BotConnectorsRepo(db).getActiveByCategory(botId, "crm").catch(() => null);
    return crm ? (CRM_PROVIDERS[crm.provider]?.name ?? crm.provider) : null;
  }

  function mapeoDe(imp: LeadImport, tabla: Tabla, campos: ReturnType<typeof camposDeImportacion>): string[] | null {
    if (!imp.mapeo) return null;
    const m = sanearMapeo(JSON.parse(imp.mapeo), tabla.encabezados, campos);
    return m.includes("telefono") || m.includes("correo") ? m : null;
  }

  app.get(`${base}/:id/revision`, async (c) => {
    const x = await contexto(c);
    if (x.denied) return x.denied;
    const b = await borrador(x, c.req.param("id"));
    if (!b.ok) return c.redirect(b.ir);
    const mapeo = mapeoDe(b.imp, b.tabla, x.campos);
    if (!mapeo) return c.redirect(`/admin${base}/${b.imp.id}`);
    const rev = await revisarImportacion(x.db, x.botId, b.tabla, mapeo);
    return c.html(
      renderImportarRevision({ niche: x.niche, visibleNavIds: x.nav, imp: b.imp, rev, campos: x.campos, crmConectado: await crmConectado(x.db, x.botId) }),
    );
  });

  app.get(`${base}/:id/errores`, async (c) => {
    const x = await contexto(c);
    if (x.denied) return x.denied;
    const b = await borrador(x, c.req.param("id"));
    if (!b.ok) return c.redirect(b.ir);
    const mapeo = mapeoDe(b.imp, b.tabla, x.campos);
    if (!mapeo) return c.redirect(`/admin${base}/${b.imp.id}`);
    const rev = await revisarImportacion(x.db, x.botId, b.tabla, mapeo);
    type Fila = (typeof rev.errores)[number];
    const cols: Columna<Fila>[] = [
      { titulo: "Fila", valor: (e) => e.numero },
      { titulo: "Motivo", valor: (e) => e.motivo },
      ...b.tabla.encabezados.map((h, i): Columna<Fila> => ({ titulo: h, valor: (e) => e.valores[i] })),
    ];
    const nombre = `errores-${b.imp.archivo.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "importacion"}.xlsx`;
    return respuestaExport("xlsx", nombre, cols, rev.errores, { hoja: "Errores" });
  });

  app.post(`${base}/:id/importar`, async (c) => {
    const x = await contexto(c);
    if (x.denied) return x.denied;
    const b = await borrador(x, c.req.param("id"));
    if (!b.ok) return c.redirect(b.ir);
    const mapeo = mapeoDe(b.imp, b.tabla, x.campos);
    if (!mapeo) return c.redirect(`/admin${base}/${b.imp.id}`);
    // Doble clic, o dos pestañas: solo una toma el borrador.
    if (!(await x.repo.tomarParaImportar(b.imp.id))) return c.redirect(`/admin${base}/${b.imp.id}`);
    try {
      // Se revisa otra vez aquí: entre la revisión y el clic pudo entrar un lead o una baja.
      const rev = await revisarImportacion(x.db, x.botId, b.tabla, mapeo);
      const r = await aplicarImportacion(x.db, x.botId, b.imp.id, rev, { consentimiento: b.imp.consentimiento, archivo: b.imp.archivo });
      await x.repo.marcarImportada(b.imp.id, {
        creados: r.creados,
        // Los que ya existían cuentan aquí aunque no les faltara nada: así lo prometió la revisión.
        completados: rev.existentes.length,
        omitidos: rev.bajas.length + rev.repetidos.length,
        errores: rev.errores.length,
      });
    } catch (e) {
      console.error("[importar] falló a medias:", e);
      await x.repo.regresarABorrador(b.imp.id);
      return c.redirect(`/admin${base}/${b.imp.id}/revision`);
    }
    return c.redirect(`/admin${base}/${b.imp.id}`);
  });

  app.post(`${base}/:id/deshacer`, async (c) => {
    const x = await contexto(c);
    if (x.denied) return x.denied;
    const imp = await x.repo.get(c.req.param("id"));
    if (!imp || imp.estado === "borrador" || imp.estado === "deshecha") return c.redirect(`/admin${base}`);
    const r = await deshacerImportacion(x.db, x.botId, imp.id);
    await x.repo.marcarDeshecha(imp.id);
    const aviso =
      `Se borraron ${r.borrados} ${r.borrados === 1 ? "contacto" : "contactos"} de ${imp.archivo}.` +
      (r.conservados ? ` ${r.conservados} se quedaron porque ya tuvieron actividad.` : "");
    return c.redirect(`/admin${base}?deshecha=${encodeURIComponent(aviso)}`);
  });
}
