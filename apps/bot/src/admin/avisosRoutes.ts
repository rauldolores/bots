// Rutas de Conexiones → Avisos (webhooks salientes). La pantalla es la
// pestaña ?cat=avisos de /admin/conexiones; aquí van las acciones. Todas
// piden conexiones.administrar, como el resto de Conexiones.
//
//   POST /conexiones/avisos                            crear (y muestra el secreto)
//   POST /conexiones/avisos/:id                        editar
//   POST /conexiones/avisos/:id/probar
//   POST /conexiones/avisos/:id/secreto                rotar (muestra el secreto)
//   POST /conexiones/avisos/:id/borrar
//   POST /conexiones/avisos/entregas/:entrega/reintentar
import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AdminBindings } from "./tenantContext";
import { NAV_PERMISSIONS, requirePermission } from "./permissions";
import { Db } from "../db/client";
import { AvisosRepo, ErrorDeAviso } from "../webhooks/salientes";
import type { DatosDeAvisos } from "./views/avisos";

const PESTANA = "/admin/conexiones?cat=avisos";

/**
 * El secreto recién creado viaja a la pestaña en una cookie de un solo uso
 * (2 min, solo para /admin/conexiones), nunca en la URL. Así la pestaña
 * se carga con GET: recargarla no vuelve a crear el aviso.
 */
const COOKIE_SECRETO = "nodia_aviso_secreto";
const RUTA_COOKIE = "/admin/conexiones";

/** Lee y borra el secreto pendiente de mostrar, si hay. Lo usa GET /conexiones. */
export function tomarSecretoUnaVez(c: Context<AdminBindings>): DatosDeAvisos["secreto"] {
  const crudo = getCookie(c, COOKIE_SECRETO);
  if (!crudo) return undefined;
  deleteCookie(c, COOKIE_SECRETO, { path: RUTA_COOKIE });
  try {
    const s = JSON.parse(crudo) as { avisoId?: unknown; valor?: unknown; nuevo?: unknown };
    if (typeof s.avisoId !== "string" || typeof s.valor !== "string") return undefined;
    return { avisoId: s.avisoId, valor: s.valor, nuevo: s.nuevo === true };
  } catch {
    return undefined;
  }
}

export function registrarRutasDeAvisos(app: Hono<AdminBindings>): void {
  function contexto(c: Context<AdminBindings>) {
    const denied = requirePermission(c, NAV_PERMISSIONS.conexiones);
    if (denied) return { denied } as const;
    const botId = c.get("botId");
    return { denied: null, botId, repo: new AvisosRepo(new Db(c.env.DB), botId) } as const;
  }

  const volver = (c: Context<AdminBindings>, q: { ok?: string; err?: string; ancla?: string }) =>
    c.redirect(
      `${PESTANA}${q.ok ? `&aviso_ok=${encodeURIComponent(q.ok)}` : ""}${q.err ? `&err=${encodeURIComponent(q.err)}` : ""}${q.ancla ?? ""}`,
      302,
    );

  const conSecreto = (c: Context<AdminBindings>, secreto: NonNullable<DatosDeAvisos["secreto"]>) => {
    setCookie(c, COOKIE_SECRETO, JSON.stringify(secreto), {
      httpOnly: true,
      secure: new URL(c.req.url).protocol === "https:",
      sameSite: "Strict",
      path: RUTA_COOKIE,
      maxAge: 120,
    });
    return c.redirect(PESTANA, 302);
  };

  const errorDe = (e: unknown) => {
    if (e instanceof ErrorDeAviso) return e.message;
    console.error("[avisos]", e);
    return "Algo falló al guardar el aviso. Intenta de nuevo.";
  };

  const datosDelForm = async (c: Context<AdminBindings>) => {
    const f = await c.req.formData();
    return {
      url: String(f.get("url") ?? ""),
      descripcion: String(f.get("descripcion") ?? ""),
      eventos: f.getAll("eventos").map(String),
      activo: f.get("activo") === "1",
    };
  };

  app.post("/conexiones/avisos", async (c) => {
    const x = contexto(c);
    if (x.denied) return x.denied;
    try {
      const d = await datosDelForm(c);
      const r = await x.repo.crear({ ...d, creadoPor: c.get("kontroliaClaims")?.email ?? null });
      return conSecreto(c, { avisoId: r.id, valor: r.secreto, nuevo: true });
    } catch (e) {
      return volver(c, { err: errorDe(e) });
    }
  });

  app.post("/conexiones/avisos/entregas/:entrega/reintentar", async (c) => {
    const x = contexto(c);
    if (x.denied) return x.denied;
    const id = Number(c.req.param("entrega"));
    try {
      if (!Number.isSafeInteger(id)) throw new ErrorDeAviso("Esa entrega no existe.");
      await x.repo.reintentar(id);
      return volver(c, { ok: "Listo: se vuelve a mandar en el siguiente minuto.", ancla: "#av-bitacora" });
    } catch (e) {
      return volver(c, { err: errorDe(e), ancla: "#av-bitacora" });
    }
  });

  app.post("/conexiones/avisos/:id/probar", async (c) => {
    const x = contexto(c);
    if (x.denied) return x.denied;
    try {
      await x.repo.probar(c.req.param("id"));
      return volver(c, { ok: "Prueba en camino: sale en menos de un minuto. Su resultado aparece en «Últimos envíos».", ancla: "#av-bitacora" });
    } catch (e) {
      return volver(c, { err: errorDe(e) });
    }
  });

  app.post("/conexiones/avisos/:id/secreto", async (c) => {
    const x = contexto(c);
    if (x.denied) return x.denied;
    try {
      const id = c.req.param("id");
      const valor = await x.repo.rotarSecreto(id);
      return conSecreto(c, { avisoId: id, valor, nuevo: false });
    } catch (e) {
      return volver(c, { err: errorDe(e) });
    }
  });

  app.post("/conexiones/avisos/:id/borrar", async (c) => {
    const x = contexto(c);
    if (x.denied) return x.denied;
    try {
      await x.repo.borrar(c.req.param("id"));
      return volver(c, { ok: "Aviso borrado." });
    } catch (e) {
      return volver(c, { err: errorDe(e) });
    }
  });

  app.post("/conexiones/avisos/:id", async (c) => {
    const x = contexto(c);
    if (x.denied) return x.denied;
    try {
      await x.repo.actualizar(c.req.param("id"), await datosDelForm(c));
      return volver(c, { ok: "Cambios guardados." });
    } catch (e) {
      return volver(c, { err: errorDe(e) });
    }
  });
}
