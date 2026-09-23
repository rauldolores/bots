// Fase 5: los botones, de ida y de vuelta.
//
// La ida (que salgan nativos) se prueba en channels/nativos.test.ts. Aquí va
// lo otro, que es lo que de verdad cuesta: que el TOQUE del cliente vuelva
// como una respuesta suya y que se conteste sin hacerlo esperar el buffer.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestDb, TEST_BOT_ID } from "../helpers/pgSetup";
import { telegramAdapter } from "../../src/channels/telegram";
import { parseWhatsAppEvents } from "../../src/channels/whatsapp";
import { parseMetaEvents } from "../../src/channels/meta";
import { ofrecerOpcionesTool, idDeEtiqueta } from "../../src/tools/ofrecerOpciones";
import { ingestMessage } from "../../src/agent/runner";
import { SettingsRepo } from "../../src/db/settings";
import type { MessagePart } from "../../src/channels/parts";
import type { Db } from "../../src/db/client";

let db: Db;
let env: any;

beforeEach(async () => {
  db = await createTestDb();
  vi.restoreAllMocks();
  vi.spyOn(SettingsRepo.prototype, "all").mockResolvedValue({});
  env = {
    DB: db.driver,
    ANTHROPIC_API_KEY: "sk-test",
    BOT_TIER: "free",
    BOT_LANGUAGE: "es",
    BUFFER_SECONDS: "15",
    BOT_NAME: "TestBot",
    BUSINESS_NAME: "TestCo",
    TELEGRAM_BOT_TOKEN: "T",
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ofrecerOpciones", () => {
  function tool() {
    const bloques: MessagePart[] = [];
    // `as any`: el tipo que devuelve tool() del SDK no expone `execute` ni el
    // `safeParse` del esquema, que es justo lo que estas pruebas ejercitan.
    const t = ofrecerOpcionesTool((p) => bloques.push(p)) as any;
    return { t, bloques };
  }

  it("deja un bloque de opciones con su pregunta y sus ids", async () => {
    const { t, bloques } = tool();
    await t.execute({
      texto: "¿Te aparto mesa?",
      opciones: [{ etiqueta: "Sí, para hoy" }, { etiqueta: "Mañana" }],
    });
    expect(bloques).toEqual([
      {
        kind: "options",
        text: "¿Te aparto mesa?",
        options: [
          { id: "1-si-para-hoy", label: "Sí, para hoy" },
          { id: "2-manana", label: "Mañana" },
        ],
      },
    ]);
  });

  it("el tope lo pone el canal más estricto: 3 opciones, 20 caracteres", () => {
    const { t } = tool();
    const cuatro = ["a", "b", "c", "d"].map((x) => ({ etiqueta: x }));
    expect(t.inputSchema.safeParse({ texto: "x", opciones: cuatro }).success).toBe(false);
    expect(
      t.inputSchema.safeParse({
        texto: "x",
        opciones: [{ etiqueta: "x".repeat(21) }, { etiqueta: "ok" }],
      }).success,
    ).toBe(false);
    // Una sola opción no es una elección.
    expect(t.inputSchema.safeParse({ texto: "x", opciones: [{ etiqueta: "ok" }] }).success).toBe(false);
  });

  it("dos etiquetas que normalizan igual no comparten id", () => {
    expect(idDeEtiqueta("Sí", 0)).not.toBe(idDeEtiqueta("Si", 1));
  });
});

describe("el toque vuelve como respuesta del cliente", () => {
  it("Telegram: del callback_query sale la ETIQUETA, no el id", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("https://x/webhooks/telegram", {
      method: "POST",
      body: JSON.stringify({
        update_id: 1,
        callback_query: {
          id: "cb-1",
          from: { id: 987, first_name: "Marisol" },
          data: "1-si-para-hoy",
          message: {
            chat: { id: 987 },
            reply_markup: {
              inline_keyboard: [
                [{ text: "Sí, para hoy", callback_data: "1-si-para-hoy" }],
                [{ text: "Mañana", callback_data: "2-manana" }],
              ],
            },
          },
        },
      }),
    });

    const msg = await telegramAdapter.parseIncoming(req, env);

    expect(msg.text).toBe("Sí, para hoy");
    expect(msg.channelUserId).toBe("987");
    expect(msg.esRespuestaDeBoton).toBe(true);
    // Sin esto el botón se queda girando en el teléfono del cliente.
    expect(
      fetchMock.mock.calls.some((c: any) => String(c[0]).includes("/answerCallbackQuery")),
    ).toBe(true);
  });

  it("WhatsApp: el title del botón es lo que se guarda", async () => {
    const [msg] = await parseWhatsAppEvents(
      {
        entry: [
          {
            changes: [
              {
                field: "messages",
                value: {
                  messages: [
                    {
                      from: "52155",
                      type: "interactive",
                      interactive: {
                        type: "button_reply",
                        button_reply: { id: "1-si-para-hoy", title: "Sí, para hoy" },
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      } as any,
      env,
      "https://bot.test",
    );

    expect(msg.text).toBe("Sí, para hoy");
    expect(msg.esRespuestaDeBoton).toBe(true);
  });

  it("Messenger: una quick reply ya no se descarta", () => {
    const msgs = parseMetaEvents({
      object: "page",
      entry: [
        {
          messaging: [
            {
              sender: { id: "u1" },
              message: { mid: "m1", text: "Sí, para hoy", quick_reply: { payload: "1-si-para-hoy" } },
            },
          ],
        },
      ],
    } as any);

    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toBe("Sí, para hoy");
    expect(msgs[0].esRespuestaDeBoton).toBe(true);
  });
});

describe("después de un toque no se espera el buffer", () => {
  it("un mensaje escrito sí espera; un botón contesta ya", async () => {
    const escrito = await ingestMessage(
      env,
      { channel: "telegram", channelUserId: "u1", text: "hola" },
      TEST_BOT_ID,
    );
    expect(escrito.scheduledInMs).toBe(15000);

    const tocado = await ingestMessage(
      env,
      { channel: "telegram", channelUserId: "u2", text: "Sí, para hoy", esRespuestaDeBoton: true },
      TEST_BOT_ID,
    );
    expect(tocado.scheduledInMs).toBe(0);

    // Y el trabajo queda vencido de una vez, no dentro de 15s.
    const fila = await db.first<{ run_after: number }>(
      "SELECT run_after FROM agent_jobs WHERE conversation_key LIKE ?",
      ["%u2"],
    );
    expect(Number(fila!.run_after)).toBeLessThanOrEqual(Date.now());
  });
});
