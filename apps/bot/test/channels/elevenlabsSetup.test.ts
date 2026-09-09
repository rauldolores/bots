/**
 * Dejar lista la prueba de ElevenLabs sin que el dueño toque nada de su lado.
 *
 * Nace de un fallo real: guardó una llave válida y una voz del catálogo, y
 * ElevenLabs respondió "esa voz no está disponible en tu cuenta" — porque las
 * voces del catálogo son COMPARTIDAS (viven en la biblioteca pública, no en la
 * cuenta de cada dueño hasta que alguien aprieta "Add to my voices" en su
 * sitio). Pedirle ese paso manual al dueño habría sido exactamente el tipo de
 * fricción técnica que este trabajo existe para evitar — así que se agrega
 * sola, buscando primero de quién es la voz en la biblioteca pública.
 *
 * Sin base de datos: SettingsRepo va simulado (mismo criterio que las pruebas
 * de proponer.ts) y la red va simulada con fetch. Lo que se prueba es la
 * DECISIÓN — buscar, agregar, crear — no si Postgres o ElevenLabs responden.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const settingsGuardados: Record<string, string> = {};
vi.mock("../../src/db/settings", () => ({
  SettingsRepo: class {
    async get(key: string) {
      return settingsGuardados[key];
    }
    async set(key: string, value: string) {
      settingsGuardados[key] = value;
    }
  },
  SETTING_KEYS: {
    voiceElevenLabsAgentId: "voice_elevenlabs_agent_id",
    voiceElevenLabsConfigHash: "voice_elevenlabs_config_hash",
    voiceElevenLabsToolIds: "voice_elevenlabs_tool_ids",
  },
}));

const { prepararAgenteElevenLabs, asegurarAgenteAlDia, huellaDeConfiguracion } = await import(
  "../../src/channels/voice/elevenlabsSetup"
);

const LLAVE = "sk_test_llave_valida";
const VOZ_DEL_CATALOGO = "nbcvT3C2tyOd2OsRAtUf";

/**
 * Cada llamada a fetch se resuelve según la RUTA exacta — nunca por substring,
 * porque "/v1/voices" es substring de "/v1/voices/add/..." y una coincidencia
 * floja confundiría "listar mis voces" con "agregar una voz".
 */
function fetchQueRespondePor(rutas: {
  voces?: () => Response;
  compartidas?: () => Response;
  agregar?: () => Response;
  crearAgente?: (cuerpo: any) => Response;
  herramientas?: () => Response;
}): typeof fetch {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const { pathname } = new URL(String(url));
    if (pathname === "/v1/voices" && rutas.voces) return rutas.voces();
    if (pathname === "/v1/shared-voices" && rutas.compartidas) return rutas.compartidas();
    if (pathname.startsWith("/v1/voices/add/") && rutas.agregar) return rutas.agregar();
    if (pathname === "/v1/convai/agents/create" && rutas.crearAgente) {
      return rutas.crearAgente(init?.body ? JSON.parse(String(init.body)) : undefined);
    }
    // Registrar herramientas: solo aparece cuando la prueba pasa tools.
    if (pathname.startsWith("/v1/convai/tools")) {
      return (rutas.herramientas ?? (() => Response.json({ id: "tool_nuevo" })))();
    }
    if (pathname.startsWith("/v1/convai/agents/")) {
      return (rutas.crearAgente ?? (() => Response.json({ agent_id: "agent-1" })))(
        init?.body ? JSON.parse(String(init.body)) : undefined,
      );
    }
    throw new Error(`fetch no esperado: ${pathname}`);
  }) as any;
}

beforeEach(() => {
  for (const k of Object.keys(settingsGuardados)) delete settingsGuardados[k];
});

describe("una voz que el dueño no tiene en su cuenta", () => {
  it("se agrega sola: la busca en la biblioteca pública y la suma a la cuenta", async () => {
    let seAgrego = false;
    global.fetch = fetchQueRespondePor({
      voces: () => Response.json({ voices: [] }), // cuenta vacía: fuerza el camino de agregar
      compartidas: () =>
        Response.json({
          voices: [{ voice_id: VOZ_DEL_CATALOGO, public_owner_id: "dueno-publico-123" }],
          has_more: false,
        }),
      agregar: () => {
        seAgrego = true;
        return Response.json({ voice_id: VOZ_DEL_CATALOGO });
      },
      crearAgente: () => Response.json({ agent_id: "agent-nuevo" }),
    });

    const r = await prepararAgenteElevenLabs({} as any, "bot1", LLAVE, VOZ_DEL_CATALOGO);
    expect(seAgrego).toBe(true);
    expect(r.ok).toBe(true);
    expect(settingsGuardados["voice_elevenlabs_agent_id"]).toBe("agent-nuevo");
  });

  it("busca en varias páginas si hace falta — no se rinde en la primera", async () => {
    let paginasVistas = 0;
    global.fetch = fetchQueRespondePor({
      voces: () => Response.json({ voices: [] }),
      compartidas: () => {
        paginasVistas++;
        if (paginasVistas === 1) {
          return Response.json({ voices: [{ voice_id: "otra-voz", public_owner_id: "x" }], has_more: true });
        }
        return Response.json({
          voices: [{ voice_id: VOZ_DEL_CATALOGO, public_owner_id: "dueno-en-pagina-2" }],
          has_more: false,
        });
      },
      agregar: () => Response.json({ voice_id: VOZ_DEL_CATALOGO }),
      crearAgente: () => Response.json({ agent_id: "agent-nuevo" }),
    });

    const r = await prepararAgenteElevenLabs({} as any, "bot1", LLAVE, VOZ_DEL_CATALOGO);
    expect(paginasVistas).toBe(2);
    expect(r.ok).toBe(true);
  });

  it("si no está en la biblioteca pública tampoco, el mensaje dice qué hacer — no muere en un error crudo", async () => {
    global.fetch = fetchQueRespondePor({
      voces: () => Response.json({ voices: [] }),
      compartidas: () => Response.json({ voices: [], has_more: false }),
    });

    const r = await prepararAgenteElevenLabs({} as any, "bot1", LLAVE, VOZ_DEL_CATALOGO);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("otra opción del catálogo");
  });

  it("si agregarla falla del lado de ElevenLabs, se avisa en vez de seguir como si nada", async () => {
    global.fetch = fetchQueRespondePor({
      voces: () => Response.json({ voices: [] }),
      compartidas: () =>
        Response.json({ voices: [{ voice_id: VOZ_DEL_CATALOGO, public_owner_id: "x" }], has_more: false }),
      agregar: () => new Response("no", { status: 500 }),
    });

    const r = await prepararAgenteElevenLabs({} as any, "bot1", LLAVE, VOZ_DEL_CATALOGO);
    expect(r.ok).toBe(false);
  });
});

describe("una voz que YA está en la cuenta", () => {
  it("no intenta agregarla — va directo a crear el agente", async () => {
    let sePidioAgregar = false;
    global.fetch = fetchQueRespondePor({
      voces: () => Response.json({ voices: [{ voice_id: VOZ_DEL_CATALOGO }] }),
      agregar: () => {
        sePidioAgregar = true;
        return Response.json({});
      },
      crearAgente: () => Response.json({ agent_id: "agent-nuevo" }),
    });

    const r = await prepararAgenteElevenLabs({} as any, "bot1", LLAVE, VOZ_DEL_CATALOGO);
    expect(sePidioAgregar).toBe(false);
    expect(r.ok).toBe(true);
  });
});

describe("el idioma del agente", () => {
  // Bug real: sin declarar el idioma, ElevenLabs asume inglés — y su
  // validación NO deja usar Flash v2.5 con un agente en inglés ("English
  // Agents must use turbo or flash v2"). Todo lo que arma este archivo es en
  // español, así que tiene que decirlo, no dejar que ElevenLabs adivine.
  it("se declara español explícitamente al crear el agente", async () => {
    let cuerpoEnviado: any = null;
    global.fetch = fetchQueRespondePor({
      voces: () => Response.json({ voices: [{ voice_id: VOZ_DEL_CATALOGO }] }),
      crearAgente: (cuerpo) => {
        cuerpoEnviado = cuerpo;
        return Response.json({ agent_id: "agent-nuevo" });
      },
    });

    await prepararAgenteElevenLabs({} as any, "bot1", LLAVE, VOZ_DEL_CATALOGO);
    expect(cuerpoEnviado.conversation_config.agent.language).toBe("es");
  });
});

describe("el LLM y el formato de audio de entrada", () => {
  // Bug real: sin declarar el LLM, ElevenLabs asigna el que tenía por default
  // al crear el agente — y ElevenLabs marcó ese default como "deprecated" en
  // su propio panel, apenas se creó. Sin declarar el formato de ENTRADA
  // (separado del de salida), el ASR recibía μ-law de Twilio esperando PCM:
  // el cliente hablaba y no se transcribía ni una palabra.
  it("declara un LLM vigente, no lo que ElevenLabs asigne por su cuenta", async () => {
    let cuerpoEnviado: any = null;
    global.fetch = fetchQueRespondePor({
      voces: () => Response.json({ voices: [{ voice_id: VOZ_DEL_CATALOGO }] }),
      crearAgente: (cuerpo) => {
        cuerpoEnviado = cuerpo;
        return Response.json({ agent_id: "agent-nuevo" });
      },
    });
    await prepararAgenteElevenLabs({} as any, "bot1", LLAVE, VOZ_DEL_CATALOGO);
    expect(cuerpoEnviado.conversation_config.agent.prompt.llm).toBeTruthy();
  });

  it("le pone tope de duración al agente — ElevenLabs cobra por minuto", async () => {
    // Sin tope, una llamada que alguien deja colgada sigue gastando créditos.
    let cuerpoEnviado: any = null;
    global.fetch = fetchQueRespondePor({
      voces: () => Response.json({ voices: [{ voice_id: VOZ_DEL_CATALOGO }] }),
      crearAgente: (cuerpo) => {
        cuerpoEnviado = cuerpo;
        return Response.json({ agent_id: "agent-nuevo" });
      },
    });
    await prepararAgenteElevenLabs({} as any, "bot1", LLAVE, VOZ_DEL_CATALOGO);
    expect(cuerpoEnviado.conversation_config.conversation.max_duration_seconds).toBeGreaterThan(0);
  });

  it("declara el formato de audio de ENTRADA, no solo el de salida", async () => {
    let cuerpoEnviado: any = null;
    global.fetch = fetchQueRespondePor({
      voces: () => Response.json({ voices: [{ voice_id: VOZ_DEL_CATALOGO }] }),
      crearAgente: (cuerpo) => {
        cuerpoEnviado = cuerpo;
        return Response.json({ agent_id: "agent-nuevo" });
      },
    });
    await prepararAgenteElevenLabs({} as any, "bot1", LLAVE, VOZ_DEL_CATALOGO);
    expect(cuerpoEnviado.conversation_config.asr.user_input_audio_format).toBe("ulaw_8000");
    expect(cuerpoEnviado.conversation_config.tts.agent_output_audio_format).toBe("ulaw_8000");
  });
});

describe("los overrides", () => {
  // Bug real: overrides vienen APAGADOS por defecto en cada agente nuevo —
  // seguridad de ElevenLabs, para que un cliente cualquiera no le haga decir
  // al agente lo que no autorizó. Sin encenderlos, ElevenLabs corta la
  // conexión en cuanto elevenlabsBridge.ts manda el prompt real de la
  // conversación: la llamada conectaba pero se quedaba muda, sin un segundo
  // de audio, porque el cierre llegaba antes de que hubiera algo que decir.
  it("se habilita el override del prompt al crear el agente", async () => {
    let cuerpoEnviado: any = null;
    global.fetch = fetchQueRespondePor({
      voces: () => Response.json({ voices: [{ voice_id: VOZ_DEL_CATALOGO }] }),
      crearAgente: (cuerpo) => {
        cuerpoEnviado = cuerpo;
        return Response.json({ agent_id: "agent-nuevo" });
      },
    });

    await prepararAgenteElevenLabs({} as any, "bot1", LLAVE, VOZ_DEL_CATALOGO);
    expect(cuerpoEnviado.platform_settings.overrides.conversation_config_override.agent.prompt.prompt).toBe(true);
  });
});

describe("mantener al agente al día", () => {
  // Pasó en producción: se corrigieron el formato de audio y el LLM del
  // agente, se desplegó, y el agente del dueño se quedó con la configuración
  // vieja — porque solo se actualizaba al guardar la pantalla, y nadie le dijo
  // que tenía que volver a guardarla. Estuvo probando llamadas contra un
  // arreglo que ya existía pero no había llegado a su agente.
  it("si la configuración ya coincide, no toca la red", async () => {
    settingsGuardados["voice_elevenlabs_config_hash"] = huellaDeConfiguracion(VOZ_DEL_CATALOGO);
    global.fetch = vi.fn(async () => {
      throw new Error("no debió llamar a la red");
    }) as any;

    const r = await asegurarAgenteAlDia({} as any, "bot1", LLAVE, VOZ_DEL_CATALOGO);
    expect(r.actualizado).toBe(false);
    expect(r.error).toBeUndefined();
  });

  it("si el código cambió algo del agente, lo actualiza solo", async () => {
    settingsGuardados["voice_elevenlabs_config_hash"] = "una-huella-vieja";
    let seActualizo = false;
    global.fetch = fetchQueRespondePor({
      voces: () => Response.json({ voices: [{ voice_id: VOZ_DEL_CATALOGO }] }),
      crearAgente: () => {
        seActualizo = true;
        return Response.json({ agent_id: "agent-nuevo" });
      },
    });

    const r = await asegurarAgenteAlDia({} as any, "bot1", LLAVE, VOZ_DEL_CATALOGO);
    expect(seActualizo).toBe(true);
    expect(r.actualizado).toBe(true);
    expect(settingsGuardados["voice_elevenlabs_config_hash"]).toBe(huellaDeConfiguracion(VOZ_DEL_CATALOGO));
  });

  // El costo de armar las herramientas NO es el de una comparación: obliga a
  // consultar los servidores MCP, y eso ocurría EN MEDIO de una llamada
  // entrante, con el cliente escuchando silencio, para casi siempre tirar el
  // resultado. Ahora se pasa una función y solo se paga si hay que reconfigurar.
  it("con la huella al día, ni siquiera arma las herramientas", async () => {
    settingsGuardados["voice_elevenlabs_config_hash"] = huellaDeConfiguracion(VOZ_DEL_CATALOGO);
    global.fetch = vi.fn(async () => {
      throw new Error("no debió llamar a la red");
    }) as any;
    let armadas = 0;

    const r = await asegurarAgenteAlDia({} as any, "bot1", LLAVE, VOZ_DEL_CATALOGO, async () => {
      armadas++;
      return {};
    });

    expect(armadas).toBe(0);
    expect(r.actualizado).toBe(false);
  });

  it("pero si SÍ hay que actualizar, las pide y las usa", async () => {
    settingsGuardados["voice_elevenlabs_config_hash"] = "una-huella-vieja";
    global.fetch = fetchQueRespondePor({
      voces: () => Response.json({ voices: [{ voice_id: VOZ_DEL_CATALOGO }] }),
      crearAgente: () => Response.json({ agent_id: "agent-nuevo" }),
    });
    let armadas = 0;

    await asegurarAgenteAlDia({} as any, "bot1", LLAVE, VOZ_DEL_CATALOGO, async () => {
      armadas++;
      return {};
    });

    expect(armadas).toBe(1);
  });

  it("si la actualización falla, se reporta pero no lanza — la llamada sigue", async () => {
    settingsGuardados["voice_elevenlabs_config_hash"] = "vieja";
    global.fetch = fetchQueRespondePor({
      voces: () => new Response("no", { status: 500 }),
    });

    const r = await asegurarAgenteAlDia({} as any, "bot1", LLAVE, VOZ_DEL_CATALOGO);
    expect(r.actualizado).toBe(false);
    expect(r.error).toBeTruthy();
  });
});

describe("la llave, antes de tocar la red", () => {
  it("rechaza el identificador de la llave — el error real que ya pasó en producción", async () => {
    const r = await prepararAgenteElevenLabs({} as any, "bot1", "no-empieza-con-sk", VOZ_DEL_CATALOGO);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('"sk_"');
  });
});

// Ocurrió de verdad al aplicar el cambio de modelo: el servidor MCP no
// respondió a tiempo, el conjunto se armó sin sus 5 herramientas, y el agente
// se reescribió con 7 en vez de 12. Como esas 7 sí se registraron, la huella se
// guardó y el sistema se quedó convencido de estar al día: la degradación se
// volvía permanente y nadie se enteraba.
describe("un tropiezo de red no puede encoger al agente", () => {
  it("aborta si se van a registrar MENOS herramientas de las que ya tiene", async () => {
    settingsGuardados["voice_elevenlabs_config_hash"] = "vieja";
    settingsGuardados["voice_elevenlabs_tool_ids"] = JSON.stringify({
      searchKb: "tool_1",
      captureLead: "tool_2",
      mcp_vinqulia_a: "tool_3",
      mcp_vinqulia_b: "tool_4",
    });
    global.fetch = vi.fn(async () => {
      throw new Error("no debió tocar la red");
    }) as any;

    // El MCP no respondió: solo llegan las estáticas.
    const r = await asegurarAgenteAlDia({} as any, "bot1", LLAVE, VOZ_DEL_CATALOGO, async () => ({
      searchKb: {},
      captureLead: {},
    }));

    expect(r.actualizado).toBe(false);
    expect(r.error).toContain("no se toca");
    // Y sobre todo: la huella NO se guarda, así que el siguiente intento lo
    // vuelve a hacer en cuanto el MCP conteste.
    expect(settingsGuardados["voice_elevenlabs_config_hash"]).toBe("vieja");
  });

  it("con el mismo número o más, sí actualiza", async () => {
    settingsGuardados["voice_elevenlabs_config_hash"] = "vieja";
    settingsGuardados["voice_elevenlabs_tool_ids"] = JSON.stringify({ searchKb: "tool_1" });
    global.fetch = fetchQueRespondePor({
      voces: () => Response.json({ voices: [{ voice_id: VOZ_DEL_CATALOGO }] }),
      crearAgente: () => Response.json({ agent_id: "agent-nuevo" }),
    });

    const r = await asegurarAgenteAlDia({} as any, "bot1", LLAVE, VOZ_DEL_CATALOGO, async () => ({
      searchKb: {},
      captureLead: {},
    }));

    expect(r.error).toBeUndefined();
  });
});

/**
 * Guardar la pantalla NO debe dejar al agente sin herramientas.
 *
 * El cuerpo del PATCH manda `tool_ids` siempre, así que un arreglo vacío se
 * lo BORRA todo. El guardado del panel llama sin pasar herramientas —no las
 * tiene a la mano— y con eso el agente quedaba hablando pero sin poder
 * agendar, capturar un lead ni consultar el CRM. Se recuperaba solo en la
 * llamada siguiente, así que el daño era invisible salvo para quien llamara
 * justo en medio.
 *
 * La huella de producción lo delataba: "tools:" vacío con 12 herramientas
 * guardadas.
 */
describe("guardar la pantalla no le quita las herramientas al agente", () => {
  const IDS_YA_REGISTRADAS = { searchKb: "tool_a", scheduleAppointment: "tool_b" };

  beforeEach(() => {
    settingsGuardados.voice_elevenlabs_agent_id = "agent-1";
    settingsGuardados.voice_elevenlabs_tool_ids = JSON.stringify(IDS_YA_REGISTRADAS);
  });

  it("sin argumento de herramientas, CONSERVA las que el agente ya tenía", async () => {
    let enviado: any;
    global.fetch = fetchQueRespondePor({
      voces: () => Response.json({ voices: [{ voice_id: VOZ_DEL_CATALOGO }] }),
      crearAgente: (cuerpo) => {
        enviado = cuerpo;
        return Response.json({ agent_id: "agent-1" });
      },
    });

    const r = await prepararAgenteElevenLabs({} as any, "bot-1", LLAVE, VOZ_DEL_CATALOGO);

    expect(r.ok).toBe(true);
    expect(enviado.conversation_config.agent.prompt.tool_ids).toEqual(["tool_a", "tool_b"]);
  });

  // Si la huella se guardara con "tools:" vacío, la llamada siguiente vería
  // una diferencia falsa y reconfiguraría al agente entero sin necesidad.
  it("y la huella queda con esas herramientas, no vacía", async () => {
    global.fetch = fetchQueRespondePor({
      voces: () => Response.json({ voices: [{ voice_id: VOZ_DEL_CATALOGO }] }),
      crearAgente: () => Response.json({ agent_id: "agent-1" }),
    });

    await prepararAgenteElevenLabs({} as any, "bot-1", LLAVE, VOZ_DEL_CATALOGO);

    expect(settingsGuardados.voice_elevenlabs_config_hash).toBe(
      huellaDeConfiguracion(VOZ_DEL_CATALOGO, ["tool_a", "tool_b"]),
    );
    expect(settingsGuardados.voice_elevenlabs_config_hash).not.toContain("tools:|");
  });

  // Un mapa VACÍO sí es una orden: el dueño las apagó todas en /admin/agente.
  it("pero un mapa vacío SÍ se las quita — eso es explícito", async () => {
    let enviado: any;
    global.fetch = fetchQueRespondePor({
      voces: () => Response.json({ voices: [{ voice_id: VOZ_DEL_CATALOGO }] }),
      crearAgente: (cuerpo) => {
        enviado = cuerpo;
        return Response.json({ agent_id: "agent-1" });
      },
    });

    await prepararAgenteElevenLabs({} as any, "bot-1", LLAVE, VOZ_DEL_CATALOGO, {});

    expect(enviado.conversation_config.agent.prompt.tool_ids).toEqual([]);
  });
});
