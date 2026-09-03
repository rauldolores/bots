import { describe, it, expect, vi, beforeEach } from "vitest";
import { vinquliaCalendarConnector } from "../../src/connectors/calendar/vinqulia";
import { CALENDAR_ADAPTERS, CALENDAR_PROVIDERS } from "../../src/connectors/registry";
import { categoryOfProvider } from "../../src/admin/views/conexiones";

const creds = { apiKey: "vk-fake", config: { url: "https://crm.miempresa.com" } };
const BASE = "https://crm.miempresa.com/api/datos/rest/v1";

/** Las llamadas que hizo el conector, para poder afirmar sobre cada una por separado. */
let llamadas: Array<{ url: string; init: any }>;

function responder(rutas: Record<string, () => Response>) {
  global.fetch = vi.fn(async (url: any, init: any) => {
    llamadas.push({ url: String(url), init });
    for (const [fragmento, hacer] of Object.entries(rutas)) {
      if (String(url).includes(fragmento)) return hacer();
    }
    return new Response("[]", { status: 200 });
  }) as any;
}

function llamada(fragmento: string) {
  return llamadas.find((l) => l.url.includes(fragmento));
}

beforeEach(() => {
  llamadas = [];
});

describe("está dado de alta en el catálogo", () => {
  it("aparece como proveedor de calendario y tiene adaptador — si falta cualquiera, la tarjeta no agenda nada", () => {
    expect(CALENDAR_PROVIDERS["vinqulia-calendar"]?.category).toBe("calendar");
    expect(CALENDAR_PROVIDERS["vinqulia-calendar"]?.comingSoon).toBeUndefined();
    expect(CALENDAR_ADAPTERS["vinqulia-calendar"]).toBe(vinquliaCalendarConnector);
  });

  // bot_connectors es único por (bot_id, provider) y el panel resuelve la
  // categoría por el id: con el mismo "vinqulia" en las tres, conectar el
  // calendario desconectaría el CRM.
  it("su id no choca con el del CRM ni con el de tickets", () => {
    expect(categoryOfProvider("vinqulia-calendar")).toBe("calendar");
    expect(categoryOfProvider("vinqulia")).toBe("crm");
    expect(categoryOfProvider("vinqulia-tickets")).toBe("tickets");
  });

  // Está dirigido a gente que no es técnica: cada campo de más es una
  // oportunidad de atorarse o de escribir un valor que el CRM no reconoce.
  // Aquí no hay nada que decidir — este conector solo crea y borra citas.
  it("pide SOLO la URL: ni vendedor ni tipo de tarea", () => {
    const fields = CALENDAR_PROVIDERS["vinqulia-calendar"]?.fields ?? [];
    expect(fields.map((f) => f.name)).toEqual(["url"]);
    expect(fields[0].optional).toBeFalsy(); // sin URL no hay a dónde agendar
  });
});

describe("vinquliaCalendarConnector.pushAppointment", () => {
  it("cuelga la cita como tarea con due_date del contacto que ya existía", async () => {
    responder({
      "/contacts?": () => new Response(JSON.stringify([{ id: 42, first_name: "Pedro" }]), { status: 200 }),
      "/tasks": () => new Response(JSON.stringify([{ id: 900 }]), { status: 201 }),
    });

    const r = await vinquliaCalendarConnector.pushAppointment(creds, {
      name: "Pedro Alcántara",
      contact: "pedro@x.com",
      startTime: "2026-09-07T16:00:00.000Z",
      notes: "Demo del plan anual",
    });

    expect(r).toEqual({ ok: true, externalId: "900" });
    const tarea = JSON.parse(llamada("/tasks")!.init.body);
    expect(tarea.contact_id).toBe(42);
    // La fecha exacta es lo que hace que la cita aparezca en la agenda del CRM.
    expect(tarea.due_date).toBe("2026-09-07T16:00:00.000Z");
    expect(tarea.text).toContain("Pedro Alcántara");
    expect(tarea.text).toContain("Demo del plan anual");
    expect(tarea.type).toBe("follow-up");
  });

  it("si la persona no está en el CRM, la da de alta antes de agendarle", async () => {
    let contactoCreado = false;
    global.fetch = vi.fn(async (url: any, init: any) => {
      llamadas.push({ url: String(url), init });
      if (String(url).includes("/contacts") && init?.method === "POST") {
        contactoCreado = true;
        return new Response(JSON.stringify([{ id: 77 }]), { status: 201 });
      }
      if (String(url).includes("/contacts")) return new Response("[]", { status: 200 }); // no existe
      if (String(url).includes("/tasks")) return new Response(JSON.stringify([{ id: 901 }]), { status: 201 });
      return new Response("[]", { status: 200 });
    }) as any;

    const r = await vinquliaCalendarConnector.pushAppointment(creds, {
      name: "Ana Ruiz",
      contact: "ana@x.com",
      startTime: "2026-09-07T16:00:00.000Z",
    });

    expect(contactoCreado).toBe(true);
    expect(r.ok).toBe(true);
    expect(JSON.parse(llamada("/tasks")!.init.body).contact_id).toBe(77);
  });

  it("a quien llegó por teléfono lo busca por teléfono, no por correo", async () => {
    responder({
      "/contacts?": () => new Response(JSON.stringify([{ id: 55 }]), { status: 200 }),
      "/tasks": () => new Response(JSON.stringify([{ id: 902 }]), { status: 201 }),
    });

    await vinquliaCalendarConnector.pushAppointment(creds, {
      name: "Pedro",
      contact: "+52 55 4334 4334",
      startTime: "2026-09-07T16:00:00.000Z",
    });

    expect(llamada("/contacts?")!.url).toContain("phone_jsonb");
  });

  // Vinqulia le pone dueño al registro por su cuenta, a partir de quien
  // autentica la clave. Comprobado en el CRM del cliente, cuyo conector no
  // tiene vendedor configurado y crea tareas y contactos sin problema.
  it("no manda sales_id: no es un dato que el dueño tenga que saber", async () => {
    responder({
      "/contacts?": () => new Response(JSON.stringify([{ id: 42 }]), { status: 200 }),
      "/tasks": () => new Response(JSON.stringify([{ id: 903 }]), { status: 201 }),
    });

    await vinquliaCalendarConnector.pushAppointment(creds, {
      name: "Pedro",
      contact: "pedro@x.com",
      startTime: "2026-09-07T16:00:00.000Z",
    });

    expect(JSON.parse(llamada("/tasks")!.init.body)).not.toHaveProperty("sales_id");
  });

  it("sin URL configurada: error claro y ni una llamada a la red", async () => {
    global.fetch = vi.fn() as any;
    const r = await vinquliaCalendarConnector.pushAppointment(
      { apiKey: "vk-fake", config: {} },
      { name: "Pedro", contact: "pedro@x.com", startTime: "2026-09-07T16:00:00.000Z" },
    );
    expect(r.ok).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("una fecha inválida se rechaza — una cita sin fecha no es una cita", async () => {
    responder({ "/contacts?": () => new Response(JSON.stringify([{ id: 42 }]), { status: 200 }) });
    const r = await vinquliaCalendarConnector.pushAppointment(creds, {
      name: "Pedro",
      contact: "pedro@x.com",
      startTime: "el jueves",
    });
    expect(r.ok).toBe(false);
    expect(llamada("/tasks")).toBeUndefined();
  });

  it("si Vinqulia rechaza la tarea, NO se reporta una cita fantasma", async () => {
    responder({
      "/contacts?": () => new Response(JSON.stringify([{ id: 42 }]), { status: 200 }),
      "/tasks": () => new Response("boom", { status: 500 }),
    });
    const r = await vinquliaCalendarConnector.pushAppointment(creds, {
      name: "Pedro",
      contact: "pedro@x.com",
      startTime: "2026-09-07T16:00:00.000Z",
    });
    expect(r.ok).toBe(false);
  });
});

describe("vinquliaCalendarConnector.cancelAppointment — la mitad que faltaba al reagendar", () => {
  it("borra la tarea por su id", async () => {
    responder({ "/tasks": () => new Response(null, { status: 204 }) }); // 204 no admite cuerpo
    const r = await vinquliaCalendarConnector.cancelAppointment!(creds, "900");
    expect(r.ok).toBe(true);
    expect(llamada("/tasks")!.url).toBe(BASE + "/tasks?id=eq.900");
    expect(llamada("/tasks")!.init.method).toBe("DELETE");
  });

  it("un 404 es éxito: si ya no está, el estado final es el que queríamos", async () => {
    responder({ "/tasks": () => new Response("", { status: 404 }) });
    expect(await vinquliaCalendarConnector.cancelAppointment!(creds, "900")).toEqual({ ok: true });
  });

  it("un error de verdad se reporta, para que el agente pueda avisarle al cliente", async () => {
    responder({ "/tasks": () => new Response("nope", { status: 403 }) });
    const r = await vinquliaCalendarConnector.cancelAppointment!(creds, "900");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("403");
  });
});

describe("vinquliaCalendarConnector.listUpcoming", () => {
  it("trae las tareas con fecha y les pone el nombre del contacto en UNA sola consulta", async () => {
    responder({
      "/tasks?": () =>
        new Response(
          JSON.stringify([
            { id: 900, contact_id: 42, text: "Cita con Pedro", due_date: "2026-09-07T16:00:00Z" },
            { id: 901, contact_id: 43, text: "Cita con Ana", due_date: "2026-09-08T16:00:00Z" },
          ]),
          { status: 200 },
        ),
      "/contacts?": () =>
        new Response(
          JSON.stringify([
            { id: 42, first_name: "Pedro", last_name: "Alcántara", email_jsonb: [{ email: "pedro@x.com" }] },
            { id: 43, first_name: "Ana", last_name: "Ruiz", phone_jsonb: [{ number: "+5255" }] },
          ]),
          { status: 200 },
        ),
    });

    const r = await vinquliaCalendarConnector.listUpcoming(creds, 10);
    expect(r.ok).toBe(true);
    expect(r.items.map((i) => i.name)).toEqual(["Pedro Alcántara", "Ana Ruiz"]);
    expect(r.items[0].contact).toBe("pedro@x.com");
    expect(r.items[0].startsAt).toBe(new Date("2026-09-07T16:00:00Z").getTime());
    expect(r.items[0].url).toContain("/contacts/42/show");
    // Dos citas, UNA consulta de contactos: una por cita haría lento el panel.
    expect(llamadas.filter((l) => l.url.includes("/contacts?"))).toHaveLength(1);
  });

  it("solo pide tareas con fecha futura — un pendiente sin fecha no es una cita", async () => {
    responder({ "/tasks?": () => new Response("[]", { status: 200 }) });
    await vinquliaCalendarConnector.listUpcoming(creds, 10);
    expect(llamada("/tasks?")!.url).toContain("due_date=gte.");
    expect(llamada("/tasks?")!.url).toContain("order=due_date.asc");
  });

  it("sin tareas no va a buscar contactos de nadie", async () => {
    responder({ "/tasks?": () => new Response("[]", { status: 200 }) });
    const r = await vinquliaCalendarConnector.listUpcoming(creds, 10);
    expect(r).toEqual({ ok: true, items: [] });
    expect(llamada("/contacts?")).toBeUndefined();
  });
});
