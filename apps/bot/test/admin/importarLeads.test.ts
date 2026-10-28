/**
 * Importar contactos a Leads (/admin/leads/importar) contra la base real:
 * el asistente completo, que no duplique ni pise, que respete a quien pidió
 * no recibir mensajes, que "Deshacer" borre solo lo suyo, y que el bot
 * reconozca al importado cuando escribe.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { adminApp } from "../../src/admin/routes";
import { Db } from "../../src/db/client";
import { LeadsRepo, leadMetadata } from "../../src/db/leads";
import { LeadContactsRepo } from "../../src/db/leadContacts";
import { OptOutsRepo } from "../../src/db/optOuts";
import { ConversationsRepo } from "../../src/db/conversations";
import { phoneVariants } from "../../src/contacts/normalize";
import { revisarImportacion } from "../../src/contacts/importar";
import { buildCustomerContext } from "../../src/customer/context";
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

const pedir = (ruta: string, init: RequestInit = {}) =>
  adminApp.request(ruta, { ...init, headers: { ...AUTH, ...((init.headers as Record<string, string>) ?? {}) } }, env);

async function subir(contenido: string, nombre = "clientes.csv"): Promise<string> {
  const form = new FormData();
  form.set("archivo", new File([contenido], nombre, { type: "text/csv" }));
  const res = await pedir("/leads/importar", { method: "POST", body: form });
  expect(res.status).toBe(302);
  const id = res.headers.get("location")!.match(/\/leads\/importar\/([0-9a-f-]{36})$/)?.[1];
  expect(id).toBeTruthy();
  return id!;
}

async function columnas(id: string, mapeo: string[], consentimiento = false) {
  const form = new URLSearchParams();
  mapeo.forEach((m, i) => form.set(`col_${i}`, m));
  if (consentimiento) form.set("consentimiento", "1");
  return pedir(`/leads/importar/${id}/columnas`, {
    method: "POST",
    body: form.toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

const importar = (id: string) => pedir(`/leads/importar/${id}/importar`, { method: "POST" });

/** Un lead que ya existía, capturado por el bot, con su teléfono. */
async function leadExistente(nombre: string, telefono: string, notas?: string) {
  const id = await new LeadsRepo(db, TEST_BOT_ID).create({ conversationId: null, channelUserId: null, name: nombre, contact: telefono, intent: "Quiere precios", notes: notas });
  await new LeadContactsRepo(db, TEST_BOT_ID).add({ leadId: id, kind: "phone", addressRaw: telefono, addressNorm: telefono, consent: "inbound" });
  return id;
}

const CSV = [
  "Nombre,Celular,Correo,Comentarios",
  "Ana López,33 1234 5678,ana@x.com,Vino a la feria", // nueva
  "Beto,+52 33 8765 4321,,", // ya existía
  "Carla,33 1111 2222,,", // pidió no recibir mensajes
  "Ana otra vez,33-1234-5678,,", // repetida (mismo número que Ana)
  "Sin datos,no tengo,,", // error
  ",,dani@x.com,", // nueva, solo correo
].join("\n");

const SELECCIONADO = (col: number, campo: string) => new RegExp(`name="col_${col}"[^>]*>(?:(?!</select>)[\\s\\S])*<option value="${campo}" selected>`);

describe("el asistente completo", () => {
  it("adivina las columnas, revisa en seco y luego importa sin duplicar ni pisar", async () => {
    const beto = await leadExistente("Beto Original", "+523387654321", "nota buena");
    for (const k of phoneVariants("+523311112222")) await new OptOutsRepo(db, TEST_BOT_ID).add(k, "prueba");

    const id = await subir(CSV);
    const paso2 = await (await pedir(`/leads/importar/${id}`)).text();
    expect(paso2).toContain("Las adivinamos por el nombre");
    expect(paso2).toMatch(SELECCIONADO(1, "telefono"));
    expect(paso2).toMatch(SELECCIONADO(3, "notas"));

    const r = await columnas(id, ["nombre", "telefono", "correo", "notas"], true);
    expect(r.headers.get("location")).toBe(`/admin/leads/importar/${id}/revision`);

    const revision = await (await pedir(`/leads/importar/${id}/revision`)).text();
    expect(revision).toContain("Importar 3 contactos"); // 2 nuevos + 1 que ya existía
    expect(revision).toContain("El dato de contacto no es válido: no tengo");
    // Revisar no escribe nada.
    expect((await new LeadsRepo(db, TEST_BOT_ID).list(50)).length).toBe(1);

    const fin = await importar(id);
    expect(fin.headers.get("location")).toBe(`/admin/leads/importar/${id}`);
    expect(await (await pedir(`/leads/importar/${id}`)).text()).toContain("Importación terminada");

    const leads = await new LeadsRepo(db, TEST_BOT_ID).list(50);
    expect(leads.length).toBe(3);
    const ana = leads.find((l) => l.name === "Ana López")!;
    expect(ana.contact).toBe("+523312345678");
    expect(ana.notes).toContain("Vino a la feria");
    const contactosAna = await new LeadContactsRepo(db, TEST_BOT_ID).listByLead(ana.id);
    expect(contactosAna.map((c) => [c.kind, c.address_norm, c.consent]).sort()).toEqual([
      ["email", "ana@x.com", "explicit"],
      ["phone", "+523312345678", "explicit"],
    ]);
    expect(leads.some((l) => l.contact === "dani@x.com")).toBe(true);
    // Beto: su nombre y su nota no se tocaron.
    const b = await new LeadsRepo(db, TEST_BOT_ID).getById(beto);
    expect(b?.name).toBe("Beto Original");
    expect(b?.notes).toBe("nota buena");
  });

  it("dos clics en Importar no importan dos veces", async () => {
    const id = await subir("Nombre,Tel\nAna,3312345678\n");
    await columnas(id, ["nombre", "telefono"]);
    await Promise.all([importar(id), importar(id)]);
    expect((await new LeadsRepo(db, TEST_BOT_ID).list(50)).length).toBe(1);
  });

  it("sin columna de teléfono ni correo no avanza", async () => {
    const id = await subir("Nombre,Tel\nAna,3312345678\n");
    const res = await columnas(id, ["nombre", ""]);
    expect(res.headers.get("location")).toContain(`/leads/importar/${id}?error=`);
  });

  it("la siguiente vez, un archivo con las mismas columnas recuerda lo que se eligió", async () => {
    const id = await subir("Dato A,Dato B\nAna,3312345678\n");
    await columnas(id, ["nombre", "telefono"]);
    await importar(id);
    const otra = await subir("Dato A,Dato B\nLuis,3399998888\n");
    const html = await (await pedir(`/leads/importar/${otra}`)).text();
    expect(html).toContain("la última vez");
    expect(html).toMatch(SELECCIONADO(1, "telefono"));
  });

  it("un archivo que no se puede leer regresa al paso 1 con el motivo", async () => {
    const form = new FormData();
    form.set("archivo", new File(["x"], "viejo.xls"));
    const res = await pedir("/leads/importar", { method: "POST", body: form });
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("formato viejo de Excel");
  });

  it("la plantilla es un Excel", async () => {
    const res = await pedir("/leads/importar/plantilla");
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
  });

  it("las filas con error se bajan en Excel", async () => {
    const id = await subir("Nombre,Tel\nAna,no tengo\nLuis,3312345678\n");
    await columnas(id, ["nombre", "telefono"]);
    const res = await pedir(`/leads/importar/${id}/errores`);
    expect(res.headers.get("content-disposition")).toContain("errores-clientes.xlsx");
  });

  it("Leads tiene el botón Importar", async () => {
    expect(await (await pedir("/leads")).text()).toContain('href="/admin/leads/importar"');
  });
});

describe("Deshacer", () => {
  it("borra solo lo que creó la importación y que sigue sin actividad", async () => {
    const previo = await leadExistente("Beto", "+523387654321");
    const id = await subir("Nombre,Tel\nAna,3312345678\nLuis,3399998888\nBeto,3387654321\n");
    await columnas(id, ["nombre", "telefono"]);
    await importar(id);
    const luis = (await new LeadsRepo(db, TEST_BOT_ID).list(50)).find((l) => l.name === "Luis")!;
    await new LeadsRepo(db, TEST_BOT_ID).setStatus(luis.id, "contacted");

    const res = await pedir(`/leads/importar/${id}/deshacer`, { method: "POST" });
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("Se borraron 1 contacto");
    const quedan = (await new LeadsRepo(db, TEST_BOT_ID).list(50)).map((l) => l.id).sort();
    expect(quedan).toEqual([previo, luis.id].sort());
    expect(await (await pedir("/leads/importar")).text()).toContain("Deshecha");
  });
});

describe("revisión", () => {
  it("los datos del giro y las columnas extra van a los datos del lead", async () => {
    const rev = await revisarImportacion(
      db,
      TEST_BOT_ID,
      { encabezados: ["Tel", "Empresa", "Presupuesto", "Cumpleaños"], filas: [["3312345678", "Acme", "50 mil", "3 de mayo"]] },
      ["telefono", "empresa", "giro:presupuesto", "extra"],
    );
    expect(rev.nuevos[0].metadata).toEqual({ empresa: "Acme", presupuesto: "50 mil", Cumpleaños: "3 de mayo" });
  });

  it("dos teléfonos en una celda cuentan los dos", async () => {
    const rev = await revisarImportacion(db, TEST_BOT_ID, { encabezados: ["Tel"], filas: [["33 1234 5678 / 33 8765 4321"]] }, ["telefono"]);
    expect(rev.nuevos[0].telefonos).toEqual(["+523312345678", "+523387654321"]);
  });
});

describe("cuando el contacto importado escribe", () => {
  it("el bot lo reconoce por su número y su lead se queda con la conversación", async () => {
    const id = await subir("Nombre,Tel,Empresa\nAna López,33 1234 5678,Acme\n");
    await columnas(id, ["nombre", "telefono", "empresa"]);
    await importar(id);

    // WhatsApp manda el número con el "1" viejo de México.
    const conv = await new ConversationsRepo(db, TEST_BOT_ID).getOrCreate("twilio", "+5213312345678", "Ana");
    const ctx = await buildCustomerContext(db, TEST_BOT_ID, { conversationId: conv.id, channelUserId: "+5213312345678" });
    expect(ctx.lead?.name).toBe("Ana López");
    expect(leadMetadata(ctx.lead!).empresa).toBe("Acme");

    const lead = await new LeadsRepo(db, TEST_BOT_ID).getById(ctx.lead!.id);
    expect(lead?.conversation_id).toBe(conv.id);
    // Ya tiene conversación: Deshacer no lo borra.
    await pedir(`/leads/importar/${id}/deshacer`, { method: "POST" });
    expect(await new LeadsRepo(db, TEST_BOT_ID).getById(lead!.id)).not.toBeNull();
  });
});
