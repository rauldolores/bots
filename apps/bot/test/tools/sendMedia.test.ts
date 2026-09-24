// "enviarArchivo": la biblioteca de medios (fase 2 de los mensajes ricos).
//
// Lo que estas pruebas cuidan, en orden de importancia:
//  1. El bot no puede mandar nada que el dueño no haya registrado.
//  2. Lo que manda sale como BLOQUE del canal (foto/documento), no como texto
//     con un enlace pegado.
//  3. El archivo llega hasta el adaptador del canal en el mismo turno.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";

const streamTextMock = vi.fn();

vi.mock("ai", () => ({
  streamText: (...args: any[]) => streamTextMock(...args),
  tool: (def: any) => def,
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => (modelId: string) => ({ modelId }),
}));

import { MediaAssetsRepo, normalizarClave, CLAVE_VALIDA } from "../../src/db/mediaAssets";
import { buildTools } from "../../src/tools";
import { ingestMessage } from "../../src/agent/runner";
import { tick } from "../../src/queue/tick";
import { SettingsRepo } from "../../src/db/settings";
import * as senderMod from "../../src/replies/sender";
import type { MessagePart } from "../../src/channels/parts";
import type { Db } from "../../src/db/client";

/**
 * El mismo helper que tick.test.ts: el runner recorre `fullStream`.
 *
 * `toolCalls` importa: un turno sin texto Y sin tool calls lo trata turn.ts
 * como turno vacío (falla y reintenta). Un turno que SÍ llamó a una
 * herramienta es válido aunque el modelo no haya escrito nada — que es justo
 * el caso "solo mándame la foto".
 */
function makeStreamResult(text: string, toolCalls: { toolName: string }[] = []) {
  async function* gen() {
    yield { type: "text-delta", text };
  }
  return {
    fullStream: gen(),
    usage: Promise.resolve({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 }),
    steps: Promise.resolve([{ toolCalls }]),
    finishReason: Promise.resolve("stop"),
    warnings: Promise.resolve([]),
  };
}

let db: Db;
let env: any;
let repo: MediaAssetsRepo;
let sendReply: ReturnType<typeof vi.fn>;

async function vencerTurnos() {
  await db.run(
    "UPDATE agent_jobs SET run_after = (EXTRACT(EPOCH FROM now()) * 1000)::bigint - 1000",
  );
}

beforeEach(async () => {
  db = await createTestDb();
  vi.restoreAllMocks();
  vi.spyOn(SettingsRepo.prototype, "all").mockResolvedValue({});
  repo = new MediaAssetsRepo(db, TEST_BOT_ID);

  streamTextMock.mockReset();
  streamTextMock.mockImplementation(() => makeStreamResult("listo"));

  sendReply = vi.fn(async () => {});
  vi.spyOn(senderMod, "pickAdapter").mockReturnValue({ sendReply } as any);

  env = {
    DB: db.driver,
    ANTHROPIC_API_KEY: "sk-test",
    BOT_TIER: "free",
    BOT_LANGUAGE: "es",
    BUFFER_SECONDS: "8",
    BOT_NAME: "TestBot",
    BUSINESS_NAME: "TestCo",
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("la biblioteca de medios", () => {
  it("guardar dos veces la misma clave reemplaza, no duplica", async () => {
    await repo.upsert({ clave: "menu", tipo: "documento", url: "https://x/v1.pdf", descripcion: "Menú" });
    await repo.upsert({ clave: "menu", tipo: "documento", url: "https://x/v2.pdf", descripcion: "Menú nuevo" });

    const todos = await repo.list();
    expect(todos).toHaveLength(1);
    expect(todos[0].url).toBe("https://x/v2.pdf");
  });

  it("normaliza lo que el dueño escribe a una clave que el modelo pueda teclear", () => {
    expect(normalizarClave("Menú de la Semana")).toBe("menu-de-la-semana");
    expect(normalizarClave("  ¡Catálogo!  ")).toBe("catalogo");
    expect(CLAVE_VALIDA.test(normalizarClave("Menú de la Semana"))).toBe(true);
  });
});

describe("la tool enviarArchivo", () => {
  it("no se anuncia cuando el negocio no ha cargado archivos", () => {
    const tools = buildTools({
      env,
      getConversationId: () => null,
      botId: TEST_BOT_ID,
      mediaAssets: [],
      adjuntar: () => {},
    });
    expect(tools.enviarArchivo).toBeUndefined();
  });

  it("tampoco se anuncia si nadie puede recibir el archivo (la voz)", async () => {
    await repo.upsert({ clave: "menu", tipo: "documento", url: "https://x/m.pdf", descripcion: "Menú" });
    const tools = buildTools({
      env,
      getConversationId: () => null,
      botId: TEST_BOT_ID,
      mediaAssets: await repo.list(),
      // sin `adjuntar`
    });
    expect(tools.enviarArchivo).toBeUndefined();
  });

  it("el esquema solo acepta claves que existen: una inventada ni llega a ejecutarse", async () => {
    await repo.upsert({ clave: "menu", tipo: "documento", url: "https://x/m.pdf", descripcion: "Menú" });
    const tools = buildTools({
      env,
      getConversationId: () => null,
      botId: TEST_BOT_ID,
      mediaAssets: await repo.list(),
      adjuntar: () => {},
    });

    expect(tools.enviarArchivo.inputSchema.safeParse({ clave: "menu" }).success).toBe(true);
    expect(tools.enviarArchivo.inputSchema.safeParse({ clave: "promo-inventada" }).success).toBe(false);
  });

  it("una imagen sale como bloque de imagen, con su pie", async () => {
    await repo.upsert({ clave: "local", tipo: "imagen", url: "https://x/local.jpg", descripcion: "Foto del local" });
    const adjuntos: MessagePart[] = [];
    const tools = buildTools({
      env,
      getConversationId: () => null,
      botId: TEST_BOT_ID,
      mediaAssets: await repo.list(),
      adjuntar: (p) => adjuntos.push(p),
    });

    const r = await tools.enviarArchivo.execute({ clave: "local", pie: "Así se ve" });

    expect(r.enviado).toBe(true);
    expect(adjuntos).toEqual([{ kind: "image", url: "https://x/local.jpg", caption: "Así se ve" }]);
  });

  it("un documento conserva su nombre de archivo", async () => {
    await repo.upsert({
      clave: "carta",
      tipo: "documento",
      url: "https://x/c.pdf",
      nombreArchivo: "carta-completa.pdf",
      descripcion: "La carta en PDF",
    });
    const adjuntos: MessagePart[] = [];
    const tools = buildTools({
      env,
      getConversationId: () => null,
      botId: TEST_BOT_ID,
      mediaAssets: await repo.list(),
      adjuntar: (p) => adjuntos.push(p),
    });

    await tools.enviarArchivo.execute({ clave: "carta" });

    expect(adjuntos[0]).toEqual({
      kind: "document",
      url: "https://x/c.pdf",
      filename: "carta-completa.pdf",
      caption: undefined,
    });
  });
});

describe("enlaces de la biblioteca", () => {
  function herramientas(adjuntos: MessagePart[]) {
    return repo.list().then((mediaAssets) =>
      buildTools({
        env,
        getConversationId: () => null,
        botId: TEST_BOT_ID,
        mediaAssets,
        adjuntar: (p) => adjuntos.push(p),
      }),
    );
  }

  it("un enlace sale como tarjeta, con el título que escribió el dueño", async () => {
    await repo.upsert({
      clave: "como-llegar",
      tipo: "enlace",
      url: "https://maps.google.com/?q=roma",
      descripcion: "La ubicación",
      titulo: "Sucursal Roma",
    });
    const adjuntos: MessagePart[] = [];
    const tools = await herramientas(adjuntos);

    await tools.enviarArchivo.execute({ clave: "como-llegar", pie: "A una cuadra del metro" });

    expect(adjuntos).toEqual([
      {
        kind: "link",
        url: "https://maps.google.com/?q=roma",
        title: "Sucursal Roma",
        description: "A una cuadra del metro",
      },
    ]);
  });

  it("sin título, la tarjeta muestra el dominio: dice al menos a dónde lleva", async () => {
    await repo.upsert({
      clave: "reservas",
      tipo: "enlace",
      url: "https://www.opentable.com/r/sabor-roma",
      descripcion: "Para reservar mesa",
    });
    const adjuntos: MessagePart[] = [];
    const tools = await herramientas(adjuntos);

    await tools.enviarArchivo.execute({ clave: "reservas" });

    expect((adjuntos[0] as any).title).toBe("opentable.com");
  });
});

describe("del modelo al canal", () => {
  it("el archivo que pidió el modelo llega al adaptador, detrás del texto", async () => {
    await repo.upsert({
      clave: "menu",
      tipo: "documento",
      url: "https://x/menu.pdf",
      nombreArchivo: "menu.pdf",
      descripcion: "El menú de la semana",
    });

    // El modelo contesta Y llama a la tool, como en un turno real.
    streamTextMock.mockImplementation((opts: any) => {
      void opts.tools.enviarArchivo.execute({ clave: "menu", pie: "Aquí va" });
      return makeStreamResult("Claro, te lo mando.", [{ toolName: "enviarArchivo" }]);
    });

    await ingestMessage(env, { channel: "telegram", channelUserId: "u1", text: "¿me pasas el menú?" });
    await vencerTurnos();
    await tick(env);

    expect(sendReply).toHaveBeenCalledTimes(1);
    const { parts } = sendReply.mock.calls[0][0];
    // El texto primero, el archivo después: se dice de qué se trata y luego llega.
    expect(parts[0]).toEqual({ kind: "text", text: "Claro, te lo mando." });
    expect(parts[parts.length - 1]).toEqual({
      kind: "document",
      url: "https://x/menu.pdf",
      filename: "menu.pdf",
      caption: "Aquí va",
    });
  });

  it("si el modelo solo manda el archivo y no dice nada, el archivo sale igual", async () => {
    await repo.upsert({ clave: "local", tipo: "imagen", url: "https://x/l.jpg", descripcion: "Foto del local" });

    streamTextMock.mockImplementation((opts: any) => {
      void opts.tools.enviarArchivo.execute({ clave: "local" });
      return makeStreamResult("", [{ toolName: "enviarArchivo" }]);
    });

    await ingestMessage(env, { channel: "telegram", channelUserId: "u2", text: "foto?" });
    await vencerTurnos();
    await tick(env);

    expect(sendReply).toHaveBeenCalledTimes(1);
    const { parts } = sendReply.mock.calls[0][0];
    expect(parts).toEqual([{ kind: "image", url: "https://x/l.jpg", caption: undefined }]);
  });

  it("si el primer intento falla tras pedir el archivo, el cliente lo recibe UNA vez", async () => {
    await repo.upsert({
      clave: "menu",
      tipo: "documento",
      url: "https://x/menu.pdf",
      nombreArchivo: "menu.pdf",
      descripcion: "El menú de la semana",
    });

    let intento = 0;
    streamTextMock.mockImplementation((opts: any) => {
      intento++;
      // Los dos intentos llaman a la tool: es lo que hace un modelo al
      // regenerar la misma respuesta.
      void opts.tools.enviarArchivo.execute({ clave: "menu" });
      if (intento === 1) throw new Error("proveedor caído a media respuesta");
      return makeStreamResult("Aquí va.", [{ toolName: "enviarArchivo" }]);
    });

    await ingestMessage(env, { channel: "telegram", channelUserId: "u3", text: "el menú" });
    await vencerTurnos();
    await tick(env);

    expect(intento).toBeGreaterThan(1); // hubo reintento de verdad
    const { parts } = sendReply.mock.calls[0][0];
    const documentos = parts.filter((p: MessagePart) => p.kind === "document");
    expect(documentos).toHaveLength(1);
  });

  it("el archivo queda guardado en el historial, para que la bandeja pueda mostrarlo", async () => {
    await repo.upsert({
      clave: "menu",
      tipo: "documento",
      url: "https://x/menu.pdf",
      nombreArchivo: "menu.pdf",
      descripcion: "El menú de la semana",
    });

    streamTextMock.mockImplementation((opts: any) => {
      void opts.tools.enviarArchivo.execute({ clave: "menu" });
      return makeStreamResult("Va.", [{ toolName: "enviarArchivo" }]);
    });

    await ingestMessage(env, { channel: "telegram", channelUserId: "u4", text: "el menú" });
    await vencerTurnos();
    await tick(env);

    const fila = await db.first<{ parts: string | null }>(
      "SELECT parts FROM messages WHERE role = 'assistant' ORDER BY created_at DESC LIMIT 1",
    );
    expect(JSON.parse(fila!.parts!)).toEqual([
      { kind: "document", url: "https://x/menu.pdf", filename: "menu.pdf" },
    ]);
  });

  it("si el canal falla, el reintento manda el archivo también — no solo el texto", async () => {
    await repo.upsert({
      clave: "menu",
      tipo: "documento",
      url: "https://x/menu.pdf",
      nombreArchivo: "menu.pdf",
      descripcion: "El menú de la semana",
    });
    streamTextMock.mockImplementation((opts: any) => {
      void opts.tools.enviarArchivo.execute({ clave: "menu" });
      return makeStreamResult("Aquí va.", [{ toolName: "enviarArchivo" }]);
    });

    await ingestMessage(env, { channel: "telegram", channelUserId: "u5", text: "el menú" });
    await vencerTurnos();
    // Primer intento: el modelo contesta, pero el canal está caído.
    sendReply.mockRejectedValueOnce(new Error("canal caído"));
    await tick(env);

    // Segundo intento: se reenvía lo apartado, sin volver a pensar.
    await vencerTurnos();
    await tick(env);

    expect(sendReply).toHaveBeenCalledTimes(2);
    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const { parts } = sendReply.mock.calls[1][0];
    expect(parts.some((p: MessagePart) => p.kind === "document")).toBe(true);
  });

  it("un turno que SOLO mandó el archivo también se reintenta", async () => {
    await repo.upsert({ clave: "local", tipo: "imagen", url: "https://x/l.jpg", descripcion: "Foto del local" });
    streamTextMock.mockImplementation((opts: any) => {
      void opts.tools.enviarArchivo.execute({ clave: "local" });
      return makeStreamResult("", [{ toolName: "enviarArchivo" }]);
    });

    await ingestMessage(env, { channel: "telegram", channelUserId: "u6", text: "foto?" });
    await vencerTurnos();
    sendReply.mockRejectedValueOnce(new Error("canal caído"));
    await tick(env);
    await vencerTurnos();
    await tick(env);

    expect(sendReply).toHaveBeenCalledTimes(2);
    expect(sendReply.mock.calls[1][0].parts).toEqual([
      { kind: "image", url: "https://x/l.jpg" },
    ]);
  });

  it("un bot no puede mandar los archivos de otro", async () => {
    await repo.upsert({ clave: "menu", tipo: "documento", url: "https://x/m.pdf", descripcion: "Menú" });
    const otro = new MediaAssetsRepo(db, "00000000-0000-0000-0000-0000000000ff");
    expect(await otro.list()).toHaveLength(0);
    expect(await otro.getByClave("menu")).toBeNull();
  });
});
