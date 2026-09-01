/**
 * Las herramientas del agente, del lado de ElevenLabs.
 *
 * Nace de una llamada real: "le pedí que me agendara una llamada y no pudo".
 * El puente conversaba bien —tenía el prompt, el playbook y la memoria del
 * cliente— pero no podía HACER nada: las herramientas nunca se registraron.
 *
 * ElevenLabs no acepta herramientas escritas dentro del agente; hay que
 * crearlas como entidades con id y referenciarlas. Eso es lo que se prueba
 * aquí: que se registren, que se REUSEN en vez de duplicarse, y que el
 * resultado de ejecutarlas vuelva bien — incluido el error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { registrarHerramientas } from "../../src/channels/voice/elevenlabsTools";

const LLAVE = "sk_prueba";

/** Una tool como las del Agent Core: descripción + esquema Zod + execute. */
function toolFalsa(descripcion: string) {
  return {
    description: descripcion,
    inputSchema: z.object({ fecha: z.string().describe("Cuándo") }),
    execute: async () => ({ ok: true }),
  };
}

let peticiones: { url: string; metodo: string; cuerpo: any }[] = [];

function fetchQueRegistra(responder: (url: string, metodo: string) => Response): typeof fetch {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const metodo = init?.method ?? "GET";
    peticiones.push({
      url: String(url),
      metodo,
      cuerpo: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return responder(String(url), metodo);
  }) as any;
}

beforeEach(() => {
  peticiones = [];
});

/** Una tool con un campo SIN describir — como captureLead.notes en el repo real. */
function toolConCampoSinDescribir() {
  return {
    description: "Captura un lead",
    inputSchema: z.object({ nombre: z.string().describe("Su nombre"), notes: z.string() }),
    execute: async () => ({ ok: true }),
  };
}

describe("registrar herramientas en ElevenLabs", () => {
  it("le pone descripción a los parámetros que no la traen", async () => {
    // Falla real: ElevenLabs EXIGE descripción en cada parámetro. Sin ella
    // responde 422 y rechaza la herramienta entera — por un solo campo se
    // caían las ocho y el agente se quedaba sin nada, confirmando citas que
    // no podía agendar.
    global.fetch = fetchQueRegistra(() => Response.json({ id: "tool_abc" }));
    await registrarHerramientas(LLAVE, { captureLead: toolConCampoSinDescribir() }, {});

    const props = peticiones[0].cuerpo.tool_config.parameters.properties;
    expect(props.notes.description).toBeTruthy();
    // La que SÍ tenía descripción propia la conserva — no se pisa.
    expect(props.nombre.description).toBe("Su nombre");
  });

  it("crea las que no existían y devuelve sus ids", async () => {
    global.fetch = fetchQueRegistra(() => Response.json({ id: "tool_abc" }));

    const r = await registrarHerramientas(LLAVE, { scheduleAppointment: toolFalsa("Agenda una cita") }, {});

    expect(r.ids).toEqual({ scheduleAppointment: "tool_abc" });
    const creada = peticiones.find((p) => p.metodo === "POST");
    expect(creada!.cuerpo.tool_config.name).toBe("scheduleAppointment");
    expect(creada!.cuerpo.tool_config.type).toBe("client");
  });

  it("manda SOLO los campos que ElevenLabs entiende — nada de $schema", async () => {
    // Falla real: el esquema del AI SDK trae "$schema" y
    // "additionalProperties", legales en JSON Schema pero que su validador
    // rechaza con 422 sin decir cuál. TODAS las herramientas fallaron y el
    // agente se quedó sin ninguna — por eso confirmó una cita que no podía
    // agendar.
    global.fetch = fetchQueRegistra(() => Response.json({ id: "tool_abc" }));
    await registrarHerramientas(LLAVE, { scheduleAppointment: toolFalsa("Agenda") }, {});

    const config = peticiones[0].cuerpo.tool_config;
    expect(config.parameters).not.toHaveProperty("$schema");
    expect(config.parameters).not.toHaveProperty("additionalProperties");
    // Y lo que SÍ importa sigue ahí — limpiar de más sería igual de inútil.
    expect(config.parameters.type).toBe("object");
    expect(config.parameters.properties.fecha.description).toBe("Cuándo");
    expect(config.parameters.required).toEqual(["fecha"]);
  });

  it("manda el esquema de parámetros, no solo el nombre", async () => {
    // Sin esquema el agente no sabe qué preguntarle al cliente.
    global.fetch = fetchQueRegistra(() => Response.json({ id: "tool_abc" }));
    await registrarHerramientas(LLAVE, { scheduleAppointment: toolFalsa("Agenda") }, {});

    const params = peticiones[0].cuerpo.tool_config.parameters;
    expect(params.properties.fecha).toBeTruthy();
  });

  it("ACTUALIZA las que ya existían en vez de duplicarlas", async () => {
    // Si se recrearan, cada despliegue dejaría herramientas huérfanas
    // acumulándose en la cuenta del dueño.
    global.fetch = fetchQueRegistra(() => Response.json({ id: "tool_viejo" }));

    const r = await registrarHerramientas(
      LLAVE,
      { scheduleAppointment: toolFalsa("Agenda") },
      { scheduleAppointment: "tool_viejo" },
    );

    expect(peticiones[0].metodo).toBe("PATCH");
    expect(peticiones[0].url).toContain("tool_viejo");
    expect(r.ids.scheduleAppointment).toBe("tool_viejo");
  });

  it("borra de la cuenta las que el bot ya no usa", async () => {
    global.fetch = fetchQueRegistra((url, metodo) =>
      metodo === "DELETE" ? new Response(null, { status: 204 }) : Response.json({ id: "tool_a" }),
    );

    await registrarHerramientas(
      LLAVE,
      { searchKb: toolFalsa("Busca") },
      { searchKb: "tool_a", herramientaQueYaNoExiste: "tool_zombie" },
    );

    const borrada = peticiones.find((p) => p.metodo === "DELETE");
    expect(borrada!.url).toContain("tool_zombie");
  });

  it("si una herramienta falla, las demás igual se registran", async () => {
    // Mejor un agente con cinco herramientas que uno con ninguna.
    let n = 0;
    global.fetch = fetchQueRegistra(() => {
      n++;
      return n === 1 ? new Response("no", { status: 400 }) : Response.json({ id: "tool_ok" });
    });

    const r = await registrarHerramientas(
      LLAVE,
      { rota: toolFalsa("Falla"), buena: toolFalsa("Funciona") },
      {},
    );

    expect(r.ids.rota).toBeUndefined();
    expect(r.ids.buena).toBe("tool_ok");
    expect(r.error).toBeUndefined();
  });

  it("si NINGUNA se pudo registrar, eso sí se reporta", async () => {
    global.fetch = fetchQueRegistra(() => new Response("no", { status: 500 }));
    const r = await registrarHerramientas(LLAVE, { a: toolFalsa("x") }, {});
    expect(r.error).toBeTruthy();
  });

  it("una herramienta recreada si alguien la borró desde ElevenLabs", async () => {
    // 404 al actualizar = ya no existe allá. Se crea de nuevo en vez de dejar
    // al agente sin ella para siempre.
    global.fetch = fetchQueRegistra((_url, metodo) =>
      metodo === "PATCH" ? new Response("no existe", { status: 404 }) : Response.json({ id: "tool_nuevo" }),
    );

    const r = await registrarHerramientas(LLAVE, { searchKb: toolFalsa("Busca") }, { searchKb: "borrada" });
    expect(r.ids.searchKb).toBe("tool_nuevo");
  });
});
