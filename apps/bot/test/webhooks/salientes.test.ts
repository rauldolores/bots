/**
 * Avisos automáticos (webhooks salientes) contra la base real: qué se emite
 * desde cada origen (y qué no), la firma, los reintentos, el apagado solo
 * tras 50 fallos, y la pestaña Conexiones → Avisos.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { adminApp } from "../../src/admin/routes";
import { Db } from "../../src/db/client";
import { LeadsRepo } from "../../src/db/leads";
import { TicketsRepo } from "../../src/db/tickets";
import { AppointmentsRepo } from "../../src/db/appointments";
import { readSecret } from "../../src/db/vault";
import {
  AvisosRepo,
  ErrorDeAviso,
  FALLOS_PARA_APAGAR,
  MAX_INTENTOS,
  emitirEvento,
  esIpInterna,
  procesarEntregas,
  purgarWebhooks,
  validarUrl,
} from "../../src/webhooks/salientes";
import type { Env } from "../../src/env";

const PASSWORD = "secret123";
const AUTH = { Authorization: `Basic ${Buffer.from(`admin:${PASSWORD}`).toString("base64")}` };
const URL_OK = "https://hooks.ejemplo.test/nodia";

let db: Db;
let env: Env;
let repo: AvisosRepo;

beforeEach(async () => {
  db = await createTestDb();
  env = {
    DB: db.driver,
    ANTHROPIC_API_KEY: "sk-test",
    BOT_NAME: "TestBot",
    BUSINESS_NAME: "Negocio de Prueba",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
    DASHBOARD_PASSWORD: PASSWORD,
    DASHBOARD_BASE_URL: "https://panel.test",
  } as unknown as Env;
  repo = new AvisosRepo(db, TEST_BOT_ID);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const pedir = (ruta: string, init: RequestInit = {}) =>
  adminApp.request(ruta, { ...init, headers: { ...AUTH, ...((init.headers as Record<string, string>) ?? {}) } }, env);

const form = (campos: Record<string, string | string[]>) => {
  const f = new URLSearchParams();
  for (const [k, v] of Object.entries(campos)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return { method: "POST", body: f.toString(), headers: { "Content-Type": "application/x-www-form-urlencoded" } };
};

async function entregas(): Promise<Array<{ id: number; estado: string; intentos: number; tipo: string; datos: unknown; proximo_intento: number }>> {
  return db.all(
    `SELECT e.id::int AS id, e.estado, e.intentos, v.tipo, v.datos, e.proximo_intento
       FROM webhook_entregas e JOIN webhook_eventos v ON v.id = e.evento_id ORDER BY e.id`,
  );
}

/** Un fetch falso que responde `status` y guarda lo que recibió. */
function receptor(status = 200, cuerpo = "ok") {
  const llamadas: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      llamadas.push({ url, init });
      return new Response(status === 204 ? null : cuerpo, { status });
    }),
  );
  return llamadas;
}

/** Fuerza que todas las entregas pendientes estén vencidas. */
const vencer = () => db.run("UPDATE webhook_entregas SET proximo_intento = 0, tomado_hasta = NULL WHERE estado = 'pendiente'");

describe("validar la dirección", () => {
  it("acepta https público y rechaza lo demás", () => {
    expect(validarUrl(" https://hooks.zapier.com/x?y=1 ")).toBe("https://hooks.zapier.com/x?y=1");
    for (const mala of [
      "http://hooks.zapier.com/x",
      "https://localhost/x",
      "https://10.0.0.5/x",
      "https://192.168.1.10/x",
      "https://172.20.0.1/x",
      "https://169.254.169.254/latest",
      "https://[::1]/x",
      "https://intranet/x",
      "https://servidor.local/x",
      "https://usuario:clave@hooks.zapier.com/x",
      "no es una url",
    ]) {
      expect(() => validarUrl(mala), mala).toThrow(ErrorDeAviso);
    }
  });

  it("reconoce IPs internas, también IPv6 y mapeadas", () => {
    expect(esIpInterna("127.0.0.1")).toBe(true);
    expect(esIpInterna("100.64.1.1")).toBe(true);
    expect(esIpInterna("::ffff:10.1.2.3")).toBe(true);
    expect(esIpInterna("fd12::1")).toBe(true);
    expect(esIpInterna("fe80::1")).toBe(true);
    expect(esIpInterna("8.8.8.8")).toBe(false);
    expect(esIpInterna("2606:4700::1111")).toBe(false);
  });
});

describe("administrar avisos", () => {
  it("guarda el secreto en Vault, no en la tabla, y lo devuelve una sola vez", async () => {
    const { id, secreto } = await repo.crear({ url: URL_OK, eventos: ["lead.creado", "inventado"] });
    expect(secreto).toMatch(/^whsec_[0-9a-f]{48}$/);
    const fila = await db.first<{ secret_ref: string; eventos: unknown }>("SELECT secret_ref, eventos FROM webhooks_salientes WHERE id = ?", [id]);
    expect(fila!.secret_ref).not.toContain("whsec_");
    expect(await readSecret(db, fila!.secret_ref)).toBe(secreto);
    expect((await repo.get(id))!.eventos).toEqual(["lead.creado"]);
  });

  it("pide al menos un evento y tope de 10 por bot", async () => {
    await expect(repo.crear({ url: URL_OK, eventos: [] })).rejects.toThrow("al menos un evento");
    for (let i = 0; i < 10; i++) await repo.crear({ url: `${URL_OK}/${i}`, eventos: ["lead.creado"] });
    await expect(repo.crear({ url: URL_OK, eventos: ["lead.creado"] })).rejects.toThrow("hasta 10");
  });

  it("rotar el secreto cambia el que se usa para firmar", async () => {
    const { id, secreto } = await repo.crear({ url: URL_OK, eventos: ["lead.creado"] });
    const nuevo = await repo.rotarSecreto(id);
    expect(nuevo).not.toBe(secreto);
    const fila = await db.first<{ secret_ref: string }>("SELECT secret_ref FROM webhooks_salientes WHERE id = ?", [id]);
    expect(await readSecret(db, fila!.secret_ref)).toBe(nuevo);
  });

  it("no toca los avisos de otro bot", async () => {
    const { id } = await repo.crear({ url: URL_OK, eventos: ["lead.creado"] });
    const otro = new AvisosRepo(db, "00000000-0000-4000-8000-0000000000aa");
    expect(await otro.get(id)).toBeNull();
    await expect(otro.actualizar(id, { url: URL_OK, eventos: ["lead.creado"], activo: false })).rejects.toThrow("ya no existe");
  });
});

describe("qué se emite", () => {
  it("sin un aviso suscrito no se guarda nada", async () => {
    await new LeadsRepo(db, TEST_BOT_ID).create({ conversationId: null, channelUserId: null, name: "Ana", intent: "comprar" });
    const n = await db.first<{ n: number }>("SELECT COUNT(*)::int AS n FROM webhook_eventos");
    expect(Number(n!.n)).toBe(0);
  });

  it("lead.creado y lead.estado, este último solo si de verdad cambió", async () => {
    await repo.crear({ url: URL_OK, eventos: ["lead.creado", "lead.estado"] });
    await repo.crear({ url: `${URL_OK}/solo-estado`, eventos: ["lead.estado"] });
    const leads = new LeadsRepo(db, TEST_BOT_ID);
    const id = await leads.create({ conversationId: null, channelUserId: null, name: "Ana", contact: "+523312345678", intent: "comprar" });
    await leads.setStatus(id, "contacted");
    await leads.setStatus(id, "contacted"); // igual: no avisa
    await leads.setStatus(id, "sold");

    const e = await entregas();
    expect(e.filter((x) => x.tipo === "lead.creado")).toHaveLength(1); // solo al suscrito
    const estados = e.filter((x) => x.tipo === "lead.estado");
    expect(estados).toHaveLength(4); // 2 cambios × 2 avisos
    const datos = estados.map((x) => (typeof x.datos === "string" ? JSON.parse(x.datos) : x.datos));
    expect(datos.map((d) => `${d.estado_anterior}→${d.estado}`).sort()).toEqual(["contactado→vendido", "contactado→vendido", "nuevo→contactado", "nuevo→contactado"]);
    expect(datos[0].nombre).toBe("Ana");
  });

  it("citas: agendar, y cancelar avisa una sola vez", async () => {
    await repo.crear({ url: URL_OK, eventos: ["cita.agendada", "cita.cancelada"] });
    const citas = new AppointmentsRepo(db, TEST_BOT_ID);
    const id = await citas.create({ conversationId: null, customerName: "Beto", startsAt: Date.UTC(2026, 10, 3, 17) });
    await citas.cancel(id);
    await citas.cancel(id);
    const e = await entregas();
    expect(e.map((x) => x.tipo)).toEqual(["cita.agendada", "cita.cancelada"]);
    const d = e[0].datos as Record<string, unknown>;
    expect((typeof d === "string" ? JSON.parse(d) : d).inicia).toBe("2026-11-03T17:00:00.000Z");
  });

  it("ticket.creado, y un aviso apagado no recibe nada", async () => {
    const { id } = await repo.crear({ url: URL_OK, eventos: ["ticket.creado"] });
    await new TicketsRepo(db, TEST_BOT_ID).create({ conversationId: null, category: "soporte", summary: "No llega", transcript: "" });
    await repo.actualizar(id, { url: URL_OK, eventos: ["ticket.creado"], activo: false });
    await new TicketsRepo(db, TEST_BOT_ID).create({ conversationId: null, category: "soporte", summary: "Otra", transcript: "" });
    expect((await entregas()).map((x) => x.tipo)).toEqual(["ticket.creado"]);
  });

  it("emitir nunca lanza", async () => {
    await expect(emitirEvento(db, "no-es-uuid", "lead.creado", {})).resolves.toBeUndefined();
  });
});

describe("enviar", () => {
  it("manda el POST firmado y lo marca entregado", async () => {
    const { secreto } = await repo.crear({ url: URL_OK, eventos: ["ticket.creado"] });
    await new TicketsRepo(db, TEST_BOT_ID).create({ conversationId: null, category: "soporte", summary: "Hola", transcript: "", requesterName: "Ana" });
    const llamadas = receptor(204, "");

    expect(await procesarEntregas(env)).toEqual({ enviadas: 1, fallidas: 0 });
    expect(llamadas).toHaveLength(1);
    const { url, init } = llamadas[0];
    expect(url).toBe(URL_OK);
    expect(init.redirect).toBe("manual");
    const h = init.headers as Record<string, string>;
    const cuerpo = String(init.body);
    const json = JSON.parse(cuerpo);
    expect(json.tipo).toBe("ticket.creado");
    expect(json.datos.nombre).toBe("Ana");
    expect(json.bot.id).toBe(TEST_BOT_ID);
    expect(h["X-Nodia-Event"]).toBe("ticket.creado");
    expect(h["X-Nodia-Event-Id"]).toBe(json.id);
    // La misma verificación que le damos al receptor en la pantalla.
    const { t, v1 } = Object.fromEntries(h["X-Nodia-Webhook-Signature"].split(",").map((p) => p.split("=")));
    expect(v1).toBe(createHmac("sha256", secreto).update(`${t}.${cuerpo}`).digest("hex"));
    expect(Math.abs(Date.now() / 1000 - Number(t))).toBeLessThan(60);

    const [e] = await entregas();
    expect(e.estado).toBe("entregado");
    expect(await procesarEntregas(env)).toEqual({ enviadas: 0, fallidas: 0 }); // no se repite
  });

  it("reintenta con espera creciente y a los 8 intentos la da por fallida", async () => {
    await repo.crear({ url: URL_OK, eventos: ["ticket.creado"] });
    await new TicketsRepo(db, TEST_BOT_ID).create({ conversationId: null, category: "x", summary: "x", transcript: "" });
    receptor(500, "caído");

    const antes = Date.now();
    await procesarEntregas(env);
    let [e] = await entregas();
    expect(e).toMatchObject({ estado: "pendiente", intentos: 1 });
    expect(Number(e.proximo_intento)).toBeGreaterThanOrEqual(antes + 60_000);
    expect(await procesarEntregas(env)).toEqual({ enviadas: 0, fallidas: 0 }); // aún no le toca

    for (let i = 2; i <= MAX_INTENTOS; i++) {
      await vencer();
      await procesarEntregas(env);
    }
    [e] = await entregas();
    expect(e).toMatchObject({ estado: "fallido", intentos: MAX_INTENTOS });
    const reg = await db.first<{ ultimo_codigo: number; ultima_respuesta: string; ultimo_error: string }>("SELECT ultimo_codigo, ultima_respuesta, ultimo_error FROM webhook_entregas");
    expect(reg).toMatchObject({ ultimo_codigo: 500, ultima_respuesta: "caído", ultimo_error: "HTTP 500" });
  });

  it("una redirección cuenta como fallo", async () => {
    await repo.crear({ url: URL_OK, eventos: ["ticket.creado"] });
    await new TicketsRepo(db, TEST_BOT_ID).create({ conversationId: null, category: "x", summary: "x", transcript: "" });
    receptor(302);
    expect(await procesarEntregas(env)).toEqual({ enviadas: 0, fallidas: 1 });
    const r = await db.first<{ ultimo_error: string }>("SELECT ultimo_error FROM webhook_entregas");
    expect(r!.ultimo_error).toContain("redirección");
  });

  it(`tras ${FALLOS_PARA_APAGAR} fallos seguidos el aviso se apaga solo; una entrega buena reinicia la cuenta`, async () => {
    const { id } = await repo.crear({ url: URL_OK, eventos: ["ticket.creado"] });
    await db.run("UPDATE webhooks_salientes SET fallos_seguidos = ? WHERE id = ?", [FALLOS_PARA_APAGAR - 2, id]);
    const tickets = new TicketsRepo(db, TEST_BOT_ID);
    await tickets.create({ conversationId: null, category: "x", summary: "uno", transcript: "" });
    receptor(200);
    await procesarEntregas(env);
    expect((await repo.get(id))!.fallos_seguidos).toBe(0);

    await db.run("UPDATE webhooks_salientes SET fallos_seguidos = ? WHERE id = ?", [FALLOS_PARA_APAGAR - 2, id]);
    await tickets.create({ conversationId: null, category: "x", summary: "dos", transcript: "" });
    await tickets.create({ conversationId: null, category: "x", summary: "tres", transcript: "" });
    receptor(503);
    await procesarEntregas(env);
    const a = (await repo.get(id))!;
    expect(a.activo).toBe(false);
    expect(a.desactivado_motivo).toContain("HTTP 503");

    // Apagado, lo pendiente ya no sale.
    await vencer();
    const llamadas = receptor(200);
    await procesarEntregas(env);
    expect(llamadas).toHaveLength(0);

    // Encenderlo a mano borra el motivo y la racha.
    await repo.actualizar(id, { url: URL_OK, eventos: ["ticket.creado"], activo: true });
    expect(await repo.get(id)).toMatchObject({ activo: true, fallos_seguidos: 0, desactivado_motivo: null });
  });

  it("la prueba llega aunque el aviso esté apagado, y no cuenta para apagarlo", async () => {
    const { id } = await repo.crear({ url: URL_OK, eventos: ["lead.creado"] });
    await repo.actualizar(id, { url: URL_OK, eventos: ["lead.creado"], activo: false });
    await repo.probar(id);
    const llamadas = receptor(500);
    await procesarEntregas(env);
    expect(llamadas).toHaveLength(1);
    expect(JSON.parse(String(llamadas[0].init.body)).tipo).toBe("webhook.prueba");
    expect((await repo.get(id))!.fallos_seguidos).toBe(0);
  });

  it("dos ticks a la vez no mandan dos veces la misma entrega", async () => {
    await repo.crear({ url: URL_OK, eventos: ["ticket.creado"] });
    await new TicketsRepo(db, TEST_BOT_ID).create({ conversationId: null, category: "x", summary: "x", transcript: "" });
    const llamadas = receptor(200);
    await Promise.all([procesarEntregas(env), procesarEntregas(env)]);
    expect(llamadas).toHaveLength(1);
  });

  it("la purga borra lo de más de 30 días", async () => {
    await repo.crear({ url: URL_OK, eventos: ["ticket.creado"] });
    await new TicketsRepo(db, TEST_BOT_ID).create({ conversationId: null, category: "x", summary: "x", transcript: "" });
    expect(await purgarWebhooks(db)).toBe(0);
    expect(await purgarWebhooks(db, Date.now() + 31 * 24 * 60 * 60_000)).toBe(1);
    expect(await entregas()).toHaveLength(0);
  });
});

describe("la pestaña Conexiones → Avisos", () => {
  /** Sigue la redirección llevando la cookie, como el navegador. */
  async function seguir(res: Response): Promise<string> {
    expect(res.status).toBe(302);
    const loc = res.headers.get("location")!;
    expect(loc).toBe("/admin/conexiones?cat=avisos");
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
    return (await pedir(loc.replace(/^\/admin/, ""), { headers: { Cookie: cookie } })).text();
  }

  it("crear redirige y muestra el secreto una sola vez, nunca en la URL", async () => {
    const res = await pedir("/conexiones/avisos", form({ url: URL_OK, descripcion: "Zapier", eventos: ["lead.creado", "cita.agendada"] }));
    const [aviso] = await repo.listar();
    expect(aviso).toMatchObject({ url: URL_OK, descripcion: "Zapier", eventos: ["lead.creado", "cita.agendada"] });
    const fila = await db.first<{ secret_ref: string }>("SELECT secret_ref FROM webhooks_salientes");
    const secreto = (await readSecret(db, fila!.secret_ref))!;
    expect(res.headers.get("location")).not.toContain(secreto);
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);

    const html = await seguir(res);
    expect(html).toContain(secreto);
    expect(html).toContain("Copia su secreto ahora");

    // Sin la cookie (ya se consumió) no vuelve a aparecer.
    const otra = await (await pedir("/conexiones?cat=avisos")).text();
    expect(otra).not.toContain(secreto);
    expect(otra).toContain("Zapier");
  });

  it("la cookie de un secreto de otro bot no se muestra", async () => {
    const cookie = `nodia_aviso_secreto=${encodeURIComponent(JSON.stringify({ avisoId: "ajeno", valor: "whsec_ajeno", nuevo: true }))}`;
    const html = await (await pedir("/conexiones?cat=avisos", { headers: { Cookie: cookie } })).text();
    expect(html).not.toContain("whsec_ajeno");
  });

  it("un error vuelve a la pestaña con el mensaje", async () => {
    const res = await pedir("/conexiones/avisos", form({ url: "http://inseguro.test", eventos: "lead.creado" }));
    expect(res.status).toBe(302);
    const loc = res.headers.get("location")!;
    expect(loc).toContain("cat=avisos");
    expect(decodeURIComponent(loc)).toContain("https://");
    const html = await (await pedir(loc.replace(/^\/admin/, ""))).text();
    expect(html).toContain("La dirección debe empezar con https://");
  });

  it("probar, ver la bitácora filtrada y reintentar", async () => {
    const { id } = await repo.crear({ url: URL_OK, eventos: ["lead.creado"] });
    expect((await pedir(`/conexiones/avisos/${id}/probar`, { method: "POST" })).status).toBe(302);
    receptor(500, "no");
    await procesarEntregas(env);

    const html = await (await pedir(`/conexiones?cat=avisos&aviso=${id}`)).text();
    expect(html).toContain("Envíos a hooks.ejemplo.test");
    expect(html).toContain("HTTP 500");
    const [e] = await entregas();
    expect(html).toContain(`/admin/conexiones/avisos/entregas/${e.id}/reintentar`);

    expect((await pedir(`/conexiones/avisos/entregas/${e.id}/reintentar`, { method: "POST" })).status).toBe(302);
    const [r] = await entregas();
    expect(r.estado).toBe("pendiente");
    expect(Number(r.proximo_intento)).toBeLessThanOrEqual(Date.now());
  });

  it("editar, nuevo secreto y borrar", async () => {
    const { id, secreto } = await repo.crear({ url: URL_OK, eventos: ["lead.creado"] });
    expect((await pedir(`/conexiones/avisos/${id}`, form({ url: `${URL_OK}/v2`, eventos: ["ticket.creado"], activo: "1" }))).status).toBe(302);
    expect(await repo.get(id)).toMatchObject({ url: `${URL_OK}/v2`, eventos: ["ticket.creado"], activo: true });

    const html = await seguir(await pedir(`/conexiones/avisos/${id}/secreto`, { method: "POST" }));
    expect(html).toContain("Nuevo secreto listo");
    expect(html).not.toContain(secreto);

    expect((await pedir(`/conexiones/avisos/${id}/borrar`, { method: "POST" })).status).toBe(302);
    expect(await repo.listar()).toHaveLength(0);
  });
});
