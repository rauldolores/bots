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
  },
}));

const { prepararAgenteElevenLabs } = await import("../../src/channels/voice/elevenlabsSetup");

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
}): typeof fetch {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const { pathname } = new URL(String(url));
    if (pathname === "/v1/voices" && rutas.voces) return rutas.voces();
    if (pathname === "/v1/shared-voices" && rutas.compartidas) return rutas.compartidas();
    if (pathname.startsWith("/v1/voices/add/") && rutas.agregar) return rutas.agregar();
    if (pathname === "/v1/convai/agents/create" && rutas.crearAgente) {
      return rutas.crearAgente(init?.body ? JSON.parse(String(init.body)) : undefined);
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

describe("la llave, antes de tocar la red", () => {
  it("rechaza el identificador de la llave — el error real que ya pasó en producción", async () => {
    const r = await prepararAgenteElevenLabs({} as any, "bot1", "no-empieza-con-sk", VOZ_DEL_CATALOGO);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('"sk_"');
  });
});
