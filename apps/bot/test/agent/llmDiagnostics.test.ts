// El diagnóstico del "turno vacío" (finishReason=length con texto vacío) —
// ver src/agent/llmDiagnostics.ts para el porqué de cada campo.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { estimarTokens, desglosarContexto, clasificarFalla, registrarDiagnosticoLlm } from "../../src/agent/llmDiagnostics";

describe("estimarTokens", () => {
  it("vacío/nulo es cero", () => {
    expect(estimarTokens("")).toBe(0);
    expect(estimarTokens(undefined)).toBe(0);
    expect(estimarTokens(null)).toBe(0);
  });

  it("~4 caracteres por token, redondeado hacia arriba", () => {
    expect(estimarTokens("hola")).toBe(1); // 4 chars
    expect(estimarTokens("hola!")).toBe(2); // 5 chars → redondea arriba
    expect(estimarTokens("a".repeat(400))).toBe(100);
  });
});

describe("desglosarContexto", () => {
  it("suma cada sección por separado y el total", () => {
    const r = desglosarContexto({
      systemPrompt: "a".repeat(400), // 100 tok
      memoryBlocks: ["b".repeat(40)], // 10 tok
      history: [{ content: "c".repeat(80) }], // 20 tok
      userText: "d".repeat(20), // 5 tok
      toolsSchemaJson: "e".repeat(40), // 10 tok
    });
    expect(r.systemPromptTokensEstimados).toBe(100);
    expect(r.memoriaTokensEstimados).toBe(10);
    expect(r.historialTokensEstimados).toBe(20);
    expect(r.mensajeActualTokensEstimados).toBe(5);
    expect(r.toolsSchemaTokensEstimados).toBe(10);
    expect(r.totalEstimado).toBe(145);
    expect(r.mensajesEnHistorial).toBe(1);
  });

  it("un mensaje de historial con contenido no-string (ej. tool result) no truena", () => {
    const r = desglosarContexto({
      systemPrompt: "",
      memoryBlocks: [],
      history: [{ content: { foo: "bar" } }],
      userText: "",
      toolsSchemaJson: "[]",
    });
    expect(r.historialTokensEstimados).toBeGreaterThan(0);
  });
});

describe("clasificarFalla", () => {
  it("finishReason=length con texto y sin tool calls: truncado normal, no la anomalía", () => {
    expect(clasificarFalla({ finishReason: "length", completo: "algo de texto", toolCallCount: 0 })).toBe(
      "truncado_con_texto_parcial",
    );
  });

  it("finishReason=length con tool calls (aunque no haya texto): no es la anomalía vacía", () => {
    expect(clasificarFalla({ finishReason: "length", completo: "", toolCallCount: 1 })).toBe(
      "truncado_con_texto_parcial",
    );
  });

  it("finishReason=length, sin texto y sin tool calls: la anomalía real", () => {
    expect(clasificarFalla({ finishReason: "length", completo: "", toolCallCount: 0 })).toBe("vacio_length");
    expect(clasificarFalla({ finishReason: "length", completo: "   ", toolCallCount: 0 })).toBe("vacio_length");
  });

  it("content-filter se distingue de length", () => {
    expect(clasificarFalla({ finishReason: "content-filter", completo: "", toolCallCount: 0 })).toBe(
      "content_filter",
    );
  });

  it("finishReason desconocido/otro cae en 'otro'", () => {
    expect(clasificarFalla({ finishReason: "stop", completo: "hola", toolCallCount: 0 })).toBe("otro");
  });

  it("un error con statusCode 429 es rate_limit", () => {
    expect(clasificarFalla({ completo: "", toolCallCount: 0, error: { statusCode: 429, message: "too many" } })).toBe(
      "rate_limit",
    );
  });

  it("un error cuyo mensaje dice 'rate limit' es rate_limit aunque no traiga statusCode", () => {
    expect(clasificarFalla({ completo: "", toolCallCount: 0, error: { message: "Rate limit exceeded" } })).toBe(
      "rate_limit",
    );
  });

  it("un AbortError es timeout", () => {
    expect(clasificarFalla({ completo: "", toolCallCount: 0, error: { name: "AbortError", message: "aborted" } })).toBe(
      "timeout",
    );
  });

  it("un mensaje con 'timeout' es timeout", () => {
    expect(clasificarFalla({ completo: "", toolCallCount: 0, error: { message: "request timeout" } })).toBe(
      "timeout",
    );
  });

  it("statusCode >= 500 es error interno del proveedor", () => {
    expect(clasificarFalla({ completo: "", toolCallCount: 0, error: { statusCode: 503, message: "unavailable" } })).toBe(
      "error_interno_proveedor",
    );
  });

  it("statusCode 400-499 (fuera de 429) es error_http", () => {
    expect(clasificarFalla({ completo: "", toolCallCount: 0, error: { statusCode: 401, message: "unauthorized" } })).toBe(
      "error_http",
    );
  });

  it("un error sin statusCode ni patrón conocido es error_red", () => {
    expect(clasificarFalla({ completo: "", toolCallCount: 0, error: { message: "fetch failed" } })).toBe(
      "error_red",
    );
  });
});

describe("registrarDiagnosticoLlm", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    spy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => spy.mockRestore());

  it("emite una sola línea con el prefijo [llmDiag] y el JSON completo", () => {
    registrarDiagnosticoLlm({
      turnId: "t1",
      numeroIntento: 1,
      timestamp: 123,
      provider: "openai",
      modelo: "gpt-4o-mini",
      endpoint: "responses",
      tipo: "vacio_length",
      finishReason: "length",
      maxOutputTokensConfigurado: 2048,
      longitudTextoGenerado: 0,
      numeroToolCalls: 0,
      latenciaMs: 500,
      contexto: {
        systemPromptTokensEstimados: 1,
        memoriaTokensEstimados: 1,
        historialTokensEstimados: 1,
        mensajeActualTokensEstimados: 1,
        toolsSchemaTokensEstimados: 1,
        totalEstimado: 5,
        mensajesEnHistorial: 1,
      },
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const linea = spy.mock.calls[0][0] as string;
    expect(linea).toMatch(/^\[llmDiag\] /);
    const parsed = JSON.parse(linea.replace("[llmDiag] ", ""));
    expect(parsed.tipo).toBe("vacio_length");
    expect(parsed.turnId).toBe("t1");
  });
});
