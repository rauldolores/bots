/**
 * Los "Exportar" del panel contra la base real: que cada archivo traiga lo que
 * dice la pantalla (filtros, mes, todos los tickets), en español y sin datos
 * de otro bot.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { createTestDb, createSecondTestBot, TEST_BOT_ID } from "../helpers/pgSetup";
import { adminApp } from "../../src/admin/routes";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { LeadsRepo } from "../../src/db/leads";
import { TicketsRepo } from "../../src/db/tickets";
import { AppointmentsRepo } from "../../src/db/appointments";
import { localTimeToUtcMs } from "../../src/datetime";
import type { Env } from "../../src/env";

const PASSWORD = "secret123";
const AUTH = { Authorization: `Basic ${Buffer.from(`admin:${PASSWORD}`).toString("base64")}` };

let db: Db;
let env: Env;

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
});

// Se decodifica a mano con ignoreBOM: res.text() se come la marca BOM, que es
// justo lo que hay que comprobar que va (sin ella Excel rompe los acentos).
const csv = async (ruta: string) => {
  const res = await adminApp.request(ruta, { headers: AUTH }, env);
  expect(res.status).toBe(200);
  return new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(await res.arrayBuffer());
};

describe("Leads", () => {
  it("CSV con BOM, encabezados en español y el estado con su etiqueta (no new/contacted)", async () => {
    await new LeadsRepo(db, TEST_BOT_ID).create({ conversationId: null, channelUserId: null, name: "Ana Núñez", contact: "+52 33 1", intent: "Quiere precios", metadata: { color: "rojo" } });
    const t = await csv("/leads/exportar?formato=csv");
    expect(t.startsWith("\uFEFFFecha,Nombre,Contacto")).toBe(true);
    expect(t).toContain("Ana Núñez");
    expect(t).toContain(",Nuevo,");
    expect(t).toContain("color: rojo");
    expect(t).not.toMatch(/,new,/);
  });

  it("la dirección vieja /leads/export.csv sigue dando el CSV", async () => {
    const res = await adminApp.request("/leads/export.csv", { headers: AUTH }, env);
    expect(res.headers.get("content-type")).toContain("text/csv");
  });

  it("Excel por defecto", async () => {
    const res = await adminApp.request("/leads/exportar", { headers: AUTH }, env);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    expect(Object.keys(unzipSync(new Uint8Array(await res.arrayBuffer())))).toContain("xl/worksheets/sheet1.xml");
  });
});

describe("Conversaciones", () => {
  it("respeta el filtro de la bandeja y no trae las de otro bot", async () => {
    const convs = new ConversationsRepo(db, TEST_BOT_ID);
    const conLead = await convs.getOrCreate("telegram", "u-lead", "Con lead");
    await convs.getOrCreate("telegram", "u-sin", "Sin lead");
    await new LeadsRepo(db, TEST_BOT_ID).create({ conversationId: conLead.id, channelUserId: "u-lead", intent: "x" });
    const otro = await createSecondTestBot(db);
    await new ConversationsRepo(db, otro).getOrCreate("telegram", "u-otro", "De otro bot");

    const todas = await csv("/conversations/exportar?formato=csv");
    expect(todas).toContain("Con lead");
    expect(todas).toContain("Sin lead");
    expect(todas).not.toContain("De otro bot");

    const leads = await csv("/conversations/exportar?formato=csv&f=leads");
    expect(leads).toContain("Con lead");
    expect(leads).not.toContain("Sin lead");
  });

  it("la transcripción trae cliente, bot y equipo en orden, sin los mensajes internos", async () => {
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("telegram", "u1", "Pepe");
    const m = new MessagesRepo(db, TEST_BOT_ID);
    await m.append(conv.id, "user", "Hola, ¿tienen cita mañana?", { createdAt: 1000 });
    await m.append(conv.id, "tool", "{interno}", { createdAt: 2000 });
    await m.append(conv.id, "assistant", "Sí, a las 10.", { createdAt: 3000 });
    await m.append(conv.id, "owner", "Te confirmo yo.", { createdAt: 4000 });

    const t = await csv(`/conversations/${conv.id}/exportar?formato=csv`);
    const lineas = t.trim().split("\r\n");
    expect(lineas[0]).toBe("\uFEFFFecha y hora,Quién,Mensaje");
    expect(lineas.slice(1).map((l) => l.split(",")[1])).toEqual(["Cliente", "Bot", "Tú (equipo)"]);
    expect(t).not.toContain("{interno}");

    const txt = await csv(`/conversations/${conv.id}/exportar?formato=txt`);
    expect(txt).toContain("Conversación con Pepe");
    expect(txt).toContain("Cliente: Hola, ¿tienen cita mañana?");
  });

  it("la conversación de otro bot no se puede bajar", async () => {
    const otro = await createSecondTestBot(db);
    const conv = await new ConversationsRepo(db, otro).getOrCreate("telegram", "u9", "Ajena");
    const res = await adminApp.request(`/conversations/${conv.id}/exportar?formato=csv`, { headers: AUTH }, env);
    expect(res.status).toBe(404);
  });
});

describe("Tickets y calendario", () => {
  it("tickets: abiertos y resueltos, con estado y prioridad en español", async () => {
    const repo = new TicketsRepo(db, TEST_BOT_ID);
    await repo.create({ conversationId: null, category: "queja", summary: "No llegó el pedido", transcript: "", priority: "urgent" });
    const resuelto = await repo.create({ conversationId: null, category: "duda", summary: "Horario", transcript: "" });
    await repo.resolve(resuelto, "admin");
    const t = await csv("/tickets/exportar?formato=csv");
    expect(t).toContain("No llegó el pedido");
    expect(t).toContain("Urgente");
    expect(t).toContain("Resuelto");
  });

  it("calendario: solo las citas del mes pedido, canceladas incluidas", async () => {
    const repo = new AppointmentsRepo(db, TEST_BOT_ID);
    const tz = "America/Mexico_City";
    await repo.create({ conversationId: null, customerName: "Lucía", startsAt: localTimeToUtcMs("2026-11-05T10:00:00", tz) });
    const cancelada = await repo.create({ conversationId: null, customerName: "Mario", startsAt: localTimeToUtcMs("2026-11-20T12:00:00", tz) });
    await repo.cancel(cancelada);
    await repo.create({ conversationId: null, customerName: "Diciembre", startsAt: localTimeToUtcMs("2026-12-01T09:00:00", tz) });
    const t = await csv("/calendario/exportar?formato=csv&month=2026-11");
    expect(t).toContain("2026-11-05 10:00,Lucía");
    expect(t).toContain("Mario");
    expect(t).toContain("Cancelada");
    expect(t).not.toContain("Diciembre");
  });
});
