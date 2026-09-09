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
import { jsonSchema } from "ai";
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

  it("reporta cuáles NO quedaron, aunque otras sí", async () => {
    // El bug que congeló todo: se registraron 5 de 11, se trató como éxito, se
    // guardó la huella, y desde entonces el registro se saltaba. El agente se
    // quedó sin scheduleAppointment ni captureLead y ningún arreglo posterior
    // llegaba a aplicarse — el bot confirmaba citas que no podía agendar.
    let n = 0;
    global.fetch = fetchQueRegistra(() => {
      n++;
      return n === 1 ? new Response("no", { status: 422 }) : Response.json({ id: "tool_ok" });
    });

    const r = await registrarHerramientas(
      LLAVE,
      { scheduleAppointment: toolFalsa("Agenda"), searchKb: toolFalsa("Busca") },
      {},
    );

    expect(r.faltantes).toEqual(["scheduleAppointment"]);
    expect(r.ids.searchKb).toBe("tool_ok");
  });

  it("cuando TODAS entran, no reporta faltantes", async () => {
    global.fetch = fetchQueRegistra(() => Response.json({ id: "tool_ok" }));
    const r = await registrarHerramientas(LLAVE, { searchKb: toolFalsa("Busca") }, {});
    expect(r.faltantes).toEqual([]);
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

/**
 * Un campo SIN `type`, anidado dentro de un arreglo de objetos — la forma
 * exacta que llegaba de un servidor MCP (vinqulia_display_task_list).
 *
 * ElevenLabs usa `type` como discriminador: si falta responde 422 con
 * "Input tag 'None' ... does not match any of the expected tags" y rechaza la
 * herramienta entera. Y eso salía carísimo por un camino indirecto: la huella
 * de configuración solo se guarda si TODAS las tools quedaron, así que con una
 * sola fallando el agente se reconfiguraba ENTERO en cada llamada entrante —
 * ~9 segundos de silencio para quien llamaba, medido en producción.
 */
function toolConHojaSinTipo() {
  return {
    description: "Muestra una lista de tareas",
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        tasks: {
          type: "array",
          description: "Las tareas",
          items: {
            type: "object",
            properties: { text: { description: "El texto de la tarea" } },
          },
        },
        nota: { type: ["string", "null"], description: "Nota opcional" },
      },
    } as any),
    execute: async () => ({ ok: true }),
  };
}

describe("el type es obligatorio: sin él ElevenLabs rechaza la herramienta entera", () => {
  it("le pone type a una hoja anidada dentro de un arreglo de objetos", async () => {
    global.fetch = fetchQueRegistra(() => Response.json({ id: "tool_1" }));

    const r = await registrarHerramientas(LLAVE, { display_task_list: toolConHojaSinTipo() }, {});

    expect(r.faltantes).toEqual([]);
    const creada = peticiones.find((p) => p.metodo === "POST")!;
    const props = creada.cuerpo.tool_config.parameters.properties;
    expect(props.tasks.items.properties.text.type).toBe("string");
  });

  it("un union ['string','null'] se reduce a un tipo único", async () => {
    global.fetch = fetchQueRegistra(() => Response.json({ id: "tool_1" }));

    await registrarHerramientas(LLAVE, { display_task_list: toolConHojaSinTipo() }, {});

    const props = peticiones.find((p) => p.metodo === "POST")!.cuerpo.tool_config.parameters.properties;
    expect(props.nota.type).toBe("string");
  });

  it("ninguna propiedad del payload se va sin type — es lo que provoca el 422", async () => {
    global.fetch = fetchQueRegistra(() => Response.json({ id: "tool_1" }));

    await registrarHerramientas(LLAVE, { display_task_list: toolConHojaSinTipo() }, {});

    const sinTipo: string[] = [];
    const revisar = (nodo: any, ruta: string) => {
      if (!nodo || typeof nodo !== "object") return;
      if (nodo.properties || nodo.items || nodo.description) {
        if (!nodo.type) sinTipo.push(ruta);
      }
      for (const [k, v] of Object.entries(nodo.properties ?? {})) revisar(v, `${ruta}.${k}`);
      if (nodo.items) revisar(nodo.items, `${ruta}[]`);
    };
    revisar(peticiones.find((p) => p.metodo === "POST")!.cuerpo.tool_config.parameters, "raiz");
    expect(sinTipo).toEqual([]);
  });
});

/**
 * El default silencioso que rompió el canal entero.
 *
 * ElevenLabs deja `expects_response` en false si no se manda: la herramienta
 * se dispara como aviso y el modelo NO recibe lo que devolvió. El puente
 * ejecutaba, distinguía el fallo del éxito y mandaba `client_tool_result` con
 * su `is_error`... y esa respuesta se descartaba antes de llegarle al agente.
 *
 * Lo que el dueño veía era otra cosa: "me está diciendo que hacía cosas
 * cuando en realidad no las hace". No era el modelo ni el prompt — era que la
 * única fuente de verdad disponible nunca le llegaba, así que para contestar
 * no le quedaba más que adivinar.
 */
describe("las herramientas ESPERAN el resultado", () => {
  it("cada tool se registra con expects_response en true", async () => {
    peticiones = [];
    global.fetch = fetchQueRegistra(() => Response.json({ id: "tool_1" }));

    await registrarHerramientas(LLAVE, { agendar: toolFalsa("Agenda una cita") }, {});

    const creada = peticiones.find((p) => p.metodo === "POST")!;
    expect(creada.cuerpo.tool_config.expects_response).toBe(true);
  });

  it("y con una espera MAYOR que el tope del puente, para que se rinda el puente primero", async () => {
    // El puente corta a los 8s y sabe DECIR por qué falló. Si ElevenLabs se
    // rindiera antes, el agente se quedaría sin resultado y volvería a adivinar.
    peticiones = [];
    global.fetch = fetchQueRegistra(() => Response.json({ id: "tool_1" }));

    await registrarHerramientas(LLAVE, { agendar: toolFalsa("Agenda una cita") }, {});

    const creada = peticiones.find((p) => p.metodo === "POST")!;
    expect(creada.cuerpo.tool_config.response_timeout_secs).toBeGreaterThan(8);
  });
});
