/**
 * Instrumentación de diagnóstico para el "turno vacío" (finishReason=length
 * con texto vacío) visto en producción con gpt-4o-mini/gpt-4o — ver
 * src/agent/turn.ts.
 *
 * Verificado leyendo el código fuente instalado (no supuesto):
 *   - `openai(modelId)` (la llamada tal cual usa createModel en llm/provider.ts)
 *     usa la RESPONSES API de OpenAI (node_modules/@ai-sdk/openai/dist/index.d.ts,
 *     firma `(modelId: OpenAIResponsesModelId): LanguageModelV3`) — Anthropic
 *     (Messages API) y xAI (Chat API) NO pasan por Responses, así que este
 *     mecanismo específico (incomplete_details, reasoning tokens ocultos) es
 *     exclusivo de las llamadas a OpenAI en este proyecto.
 *   - `finishReason` público del SDK ('stop'|'length'|'content-filter'|
 *     'tool-calls'|'error'|'other') es SIEMPRE una traducción de
 *     `incomplete_details.reason` de OpenAI — la función que hace esa
 *     traducción (mapOpenAIResponseFinishReason, en el paquete
 *     @ai-sdk/openai) solo produce 'length' cuando
 *     `incomplete_details.reason === "max_output_tokens"`. El string crudo
 *     de OpenAI se descarta después de mapearse: el SDK NO lo expone en
 *     providerMetadata ni en ningún otro lado accesible. Por eso, ver
 *     finishReason==='length' es 100% equivalente a que OpenAI reportó
 *     `incomplete_details: { reason: "max_output_tokens" }` — es una
 *     deducción verificada contra el código fuente, no una suposición.
 *   - `usage.outputTokenDetails.reasoningTokens` SÍ existe en el tipo público
 *     de "ai" (LanguageModelUsage) y SÍ lo llena @ai-sdk/openai desde
 *     `output_tokens_details.reasoning_tokens` de la Responses API — aunque
 *     gpt-4o-mini/gpt-4o no son modelos de razonamiento, si este campo sale
 *     > 0 en un turno vacío es la prueba de que OpenAI gastó el presupuesto
 *     de salida en algo que nunca se ve como texto.
 */

/** Heurística de caracteres→tokens (≈4 caracteres por token en español/inglés).
 * NO es un conteo real — para eso hace falta el tokenizer exacto del
 * proveedor (tiktoken para OpenAI), que este proyecto no trae como
 * dependencia. Sirve para comparar el TAMAÑO RELATIVO de cada sección del
 * prompt entre sí; para el total real de entrada, usa `usage.inputTokens`
 * (eso sí es la cifra exacta que devolvió el proveedor). */
export function estimarTokens(texto: string | undefined | null): number {
  if (!texto) return 0;
  return Math.ceil(texto.length / 4);
}

export interface DesgloseContexto {
  systemPromptTokensEstimados: number;
  memoriaTokensEstimados: number;
  historialTokensEstimados: number;
  mensajeActualTokensEstimados: number;
  toolsSchemaTokensEstimados: number;
  totalEstimado: number;
  /** Cuántos mensajes trae el historial que se mandó (no su tamaño, solo el conteo). */
  mensajesEnHistorial: number;
}

/**
 * Desglose ESTIMADO de a qué sección se fue el contexto de este turno.
 * Nunca recibe el texto de vuelta en el log — solo tamaños. Ver estimarTokens
 * para la limitación de precisión.
 */
export function desglosarContexto(input: {
  systemPrompt: string;
  memoryBlocks: string[];
  /** Mensajes que se mandan como `messages` a streamText (ya excluye el system prompt). */
  history: Array<{ content?: unknown }>;
  userText: string;
  /** JSON.stringify de las tools habilitadas — para saber cuánto pesa su schema. */
  toolsSchemaJson: string;
}): DesgloseContexto {
  const memoriaTexto = input.memoryBlocks.join("\n");
  const historialTexto = input.history
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")))
    .join("\n");
  const systemPromptTokensEstimados = estimarTokens(input.systemPrompt);
  const memoriaTokensEstimados = estimarTokens(memoriaTexto);
  const historialTokensEstimados = estimarTokens(historialTexto);
  const mensajeActualTokensEstimados = estimarTokens(input.userText);
  const toolsSchemaTokensEstimados = estimarTokens(input.toolsSchemaJson);
  return {
    systemPromptTokensEstimados,
    memoriaTokensEstimados,
    historialTokensEstimados,
    mensajeActualTokensEstimados,
    toolsSchemaTokensEstimados,
    totalEstimado:
      systemPromptTokensEstimados +
      memoriaTokensEstimados +
      historialTokensEstimados +
      mensajeActualTokensEstimados +
      toolsSchemaTokensEstimados,
    mensajesEnHistorial: input.history.length,
  };
}

/**
 * Las categorías que de verdad importan para diagnosticar esto — cada una
 * apunta a una causa distinta y por lo tanto a un arreglo distinto:
 *   - vacio_length: la anomalía que dispara todo esto. Ver el comentario de
 *     arriba del archivo — significa `incomplete_details.reason ===
 *     "max_output_tokens"` con CERO texto y CERO tool calls.
 *   - truncado_con_texto_parcial: finishReason=length pero SÍ hay texto — es
 *     el corte "normal" (una respuesta larga que de verdad se quedó sin
 *     espacio), no la anomalía.
 *   - content_filter: el propio proveedor bloqueó la respuesta.
 *   - rate_limit / timeout / error_http / error_interno_proveedor: fallas que
 *     SÍ lanzan excepción — se distinguen por el shape del error
 *     (APICallError trae statusCode; un timeout viene marcado como tal).
 *   - error_red: la excepción no tiene forma de error de API (sin
 *     statusCode) — probablemente la conexión se cortó antes de llegar a
 *     OpenAI.
 *   - otro: cualquier cosa que no encaje arriba — mejor admitirlo que
 *     forzarlo a una categoría que no le corresponde.
 */
export type TipoFallaLlm =
  | "vacio_length"
  | "truncado_con_texto_parcial"
  | "content_filter"
  | "rate_limit"
  | "timeout"
  | "error_http"
  | "error_interno_proveedor"
  | "error_red"
  | "otro";

export function clasificarFalla(input: {
  finishReason?: string;
  completo: string;
  toolCallCount: number;
  error?: unknown;
}): TipoFallaLlm {
  const { finishReason, completo, toolCallCount, error } = input;

  if (error) {
    const e = error as { statusCode?: number; name?: string; message?: string; code?: string };
    const statusCode = e?.statusCode;
    const msg = `${e?.message ?? ""} ${e?.name ?? ""} ${e?.code ?? ""}`.toLowerCase();
    if (statusCode === 429 || msg.includes("rate limit") || msg.includes("rate_limit")) return "rate_limit";
    if (
      msg.includes("timeout") ||
      msg.includes("timed out") ||
      e?.name === "AbortError" ||
      e?.code === "ETIMEDOUT"
    ) {
      return "timeout";
    }
    if (typeof statusCode === "number" && statusCode >= 500) return "error_interno_proveedor";
    if (typeof statusCode === "number" && statusCode >= 400) return "error_http";
    // Sin statusCode: nunca llegó a tener una respuesta HTTP que clasificar —
    // lo más probable es un corte de red antes de conectar con el proveedor.
    return "error_red";
  }

  if (finishReason === "content-filter") return "content_filter";
  if (finishReason === "length") {
    return !completo.trim() && toolCallCount === 0 ? "vacio_length" : "truncado_con_texto_parcial";
  }
  return "otro";
}

/** Lo que sabemos sobre UNA llamada a streamText — éxito o falla. */
export interface DiagnosticoLlm {
  /** Une todos los intentos del MISMO turno (mismo mensaje del cliente) — no es el request_id de OpenAI, es nuestro. */
  turnId: string;
  /** 1 = intento primario, 2 = reintento primario, 3 = degradado, 4 = otro nivel, 5/6 = proveedor de respaldo. */
  numeroIntento: number;
  timestamp: number;
  provider: string;
  modelo: string;
  /** Verificado solo para OpenAI (ver comentario de arriba) — para los demás, honesto: no se confirmó cuál usan. */
  endpoint: "responses" | "messages" | "chat" | "desconocido (no verificado)";
  tipo: TipoFallaLlm;
  finishReason?: string;
  /** SIEMPRE 'max_output_tokens' cuando finishReason==='length' — ver comentario de arriba del archivo sobre por qué esto es una deducción verificada, no un dato crudo disponible en runtime. */
  incompleteDetailsReasonDeducido?: string;
  responseId?: string;
  /** Header HTTP crudo `x-request-id`, cuando el proveedor lo expone. */
  requestId?: string;
  statusCode?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  /** El límite que NOSOTROS configuramos en la llamada (maxOutputTokens) — no lo que el proveedor decidió. */
  maxOutputTokensConfigurado: number;
  longitudTextoGenerado: number;
  numeroToolCalls: number;
  latenciaMs: number;
  contexto: DesgloseContexto;
  /** Mensaje de la excepción, si la hubo — nunca contenido de la conversación. */
  errorMensaje?: string;
  warnings?: unknown;
}

/**
 * Una sola línea de log, estructurada como JSON, con un prefijo fijo
 * ([llmDiag]) para poder filtrarla en los logs de Vercel. A propósito NUNCA
 * incluye el texto de la conversación ni el contenido de las tools — solo
 * tamaños, ids y metadatos.
 */
export function registrarDiagnosticoLlm(diag: DiagnosticoLlm): void {
  console.error(`[llmDiag] ${JSON.stringify(diag)}`);
}
