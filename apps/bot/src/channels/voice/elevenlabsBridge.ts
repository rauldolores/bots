/**
 * Puente de llamada con ElevenLabs Agents.
 *
 * Prueba controlada frente a OpenAI Realtime, EN EL MISMO NÚMERO — no hay un
 * segundo número donde aislarla, así que quién la atiende se decide por
 * llamada (ver callBridge.ts) y producción no puede romperse.
 *
 * Lo que esta primera versión SÍ prueba: cómo suena, cuánto tarda en contestar
 * y cuánto cuesta de verdad. Lo que todavía NO: las herramientas. ElevenLabs
 * las expone por su propio mecanismo y conectarlas es el paso siguiente — pero
 * el prompt SÍ es el del agente real (buildAgentContext), no uno escrito en su
 * panel: comparar contra otra personalidad no probaría nada.
 *
 * μ-law 8 kHz en ambos lados: el audio de Twilio se reenvía sin transcodificar.
 */
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { buildAgentContext } from "../../agent/context";
import { conversationKeyOf } from "../../agent/key";
import { ConversationsRepo } from "../../db/conversations";
import { MessagesRepo } from "../../db/messages";
import { ElevenLabsClient } from "./elevenlabsClient";
import { VOICE_CHANNEL } from "./session";
import { BotChannelsRepo } from "../../db/botChannels";
import { transferToHumanTool } from "./tools/transferToHuman";
import { consultarTareaTool, type TareaDelegada } from "./tools/consultarTarea";
import { transferirLlamadaViva } from "./transfer";
import { encolarAnalisisDeLlamada } from "./analisisPostLlamada";
import { verificarLlamada } from "./verificarPromesas";
import { validarParametros } from "./validarParametros";
import { buildClearMessage, buildMediaMessage } from "./mediaStreamProtocol";
import { bloqueLlamadaEnCurso, bloqueLimites, VOICE_BEHAVIOR_ADDENDUM } from "./voiceInstructions";
import { resolveVoiceGreeting } from "./voiceGreeting";
import { motivoDeFallo, camposConValor, pistaAccionable } from "./toolResult";

import { logVoiceEvent, maskId } from "./log";
import { createCallMetrics, type CallMetrics } from "./metrics";
import { recordCallEvent } from "./events";
import { estimateElevenLabsCost, estimateTelephonyCost, resolveTelephonyCostPerMinute } from "./callCost";
import { VoiceSessionsRepo, type VoiceTranscriptTurn } from "../../db/voiceSessions";
import { SettingsRepo, SETTING_KEYS } from "../../db/settings";
import type { CallBridge, CallBridgeDeps } from "./callBridge";

/**
 * Tope para una herramienta, igual que en el puente de OpenAI.
 *
 * Ojo con subirlo: allá 8 s resultaron cortos para captureLead y el modelo
 * creyó que había fallado cuando sí había guardado (ver leads/postCaptura.ts,
 * que sacó el CRM y el aviso fuera del camino crítico justo por eso).
 */
const TOOL_TIMEOUT_MS = 8_000;

export class ElevenLabsCallBridge implements CallBridge {
  private client: ElevenLabsClient | null = null;
  private metrics: CallMetrics = createCallMetrics();
  private conversationId = "";
  private callRowId = "";
  private cerrado = false;
  /** Cuándo dejó de hablar el cliente — la mitad del cálculo de latencia. */
  private finDeTurnoDelCliente: number | null = null;
  /** Solo para registrar UNA vez que el audio del cliente empezó a fluir. */
  private audioDelClienteEnviado = false;
  /** Lo mismo, en la otra dirección: ¿ElevenLabs llegó a mandar audio? */
  private audioDelAgenteRecibido = false;
  /** Las tools del Agent Core — las MISMAS del chat, con su execute() real. */
  private tools: Record<string, any> = {};
  /**
   * Qué nombres de `this.tools` vienen de un servidor MCP — ver
   * agent/context.ts::AgentContext.mcpToolNames. El prefijo lo elige el
   * dueño por conector (nunca un patrón fijo tipo "mcp_algo"), así que sin
   * este set no hay forma de saber, mirando solo el nombre, cuáles delegar.
   */
  private mcpToolNames: Set<string> = new Set();
  /**
   * Acciones MCP delegadas en esta llamada (F-compañero, portado del puente
   * de OpenAI) y su resultado, para que consultar_tarea pueda responder
   * cuando el agente pregunte "¿ya quedó?". En memoria del proceso porque el
   * puente completo también — no hay nada que persistir aquí más allá de lo
   * que ya persiste la tool en sí.
   */
  private tareasDelegadas: Map<string, TareaDelegada> = new Map();
  /** La última tarea delegada — consultar_tarea la usa cuando el modelo omite tarea_id (el caso común: casi nunca hay más de una a la vez). */
  private ultimaTareaDelegadaId: string | null = null;
  /** Transferencia pedida y aún no hecha — espera a que el agente termine de avisarle al cliente. */
  private transferenciaPendiente = false;
  /** Transcripción de la llamada — solo si el dueño la habilitó; se escribe UNA vez, al cerrar. */
  private transcripcion: VoiceTranscriptTurn[] = [];
  private guardarTranscripcion = false;
  /** Última señal de vida de la llamada — la base del vigilante de silencio. */
  private ultimaActividad = Date.now();
  private vigilanteDeSilencio: ReturnType<typeof setInterval> | null = null;

  private constructor(private readonly deps: CallBridgeDeps) {}

  static async start(
    deps: CallBridgeDeps,
    creds: { apiKey: string; agentId: string },
  ): Promise<ElevenLabsCallBridge> {
    const bridge = new ElevenLabsCallBridge(deps);
    await bridge.conectar(creds);
    bridge.metrics.callStartedAt = Date.now();
    bridge.arrancarVigilanteDeSilencio();
    logVoiceEvent("call_started", {
      botId: deps.botId,
      callSid: maskId(deps.callSid),
      proveedor: "elevenlabs",
    });
    return bridge;
  }

  /** Desglose de lo que tardó armar el contexto — se registra al iniciar, ver abajo. */
  private timings: { totalMs: number; mcpMs: number } | null = null;

  private db(): Db {
    return new Db(this.deps.env.DB);
  }

  private async conectar(creds: { apiKey: string; agentId: string }): Promise<void> {
    const { botId, callerId } = this.deps;
    const t0 = Date.now();
    const ctx = await this.prepararConversacion();
    const msPreparacion = Date.now() - t0;

    this.client = new ElevenLabsClient(creds.apiKey, creds.agentId, {
      onAudio: (b64) => this.audioHaciaTwilio(b64),
      onInterruption: () => this.interrumpido(),
      onUserTranscript: (t) => void this.persistirTurno("user", t),
      onAgentResponse: (t) => void this.persistirTurno("assistant", t),
      onError: (e) => console.error("[voice-elevenlabs] error:", e),
      onEvento: (tipo, evento) => this.eventoDeElevenLabs(tipo, evento),
      onToolCall: (llamada) => void this.ejecutarHerramienta(llamada),
      onClose: () => logVoiceEvent("elevenlabs_closed", { botId, callSid: maskId(this.deps.callSid) }),
    });

    // Se registra QUÉ se le manda: un saludo vacío haría que el agente espere
    // en silencio a que el cliente hable, que se oye igual que estar roto.
    logVoiceEvent("elevenlabs_iniciando", {
      botId,
      callSid: maskId(this.deps.callSid),
      saludo: (ctx.saludo ?? "").slice(0, 80),
      promptChars: ctx.prompt.length,
      // El tamaño solo dice que ALGO se mandó. Estas dos banderas dicen QUÉ:
      // el dueño notó que el bot nunca pide la empresa aunque su playbook lo
      // exige, y "el prompt mide 26 mil caracteres" no distingue entre un
      // playbook que no se inyectó y un modelo que lo ignoró.
      llevaPlaybook: ctx.prompt.includes("PLAYBOOK"),
      pideEmpresa: ctx.prompt.includes("empresa nos contacta"),
      herramientas: Object.keys(this.tools).length,
      // El desglose de la espera ANTES de saludar. Sin esto solo se veía el
      // hueco entre gateway_start y este log, y de ahí no se puede saber si
      // los segundos son de la base, de los servidores MCP o de otra cosa —
      // que es exactamente el callejón en el que estuvimos.
      msPreparacion,
      msContexto: this.timings?.totalMs ?? null,
      msMcp: this.timings?.mcpMs ?? null,
    });
    const tConn = Date.now();
    await this.client.connect({ prompt: ctx.prompt, firstMessage: ctx.saludo });
    const msConexion = Date.now() - tConn;
    this.callRowId = this.deps.voiceSession.getContext().callId;
    await recordCallEvent(this.db(), botId, this.callRowId, "call.answered", { proveedor: "elevenlabs" });
    logVoiceEvent("elevenlabs_connected", {
      botId,
      callSid: maskId(this.deps.callSid),
      callerId: maskId(callerId),
      msConexion,
      msTotalHastaSaludar: Date.now() - t0,
    });
  }

  /**
   * El MISMO prompt que usa el agente en producción — personalidad, negocio,
   * idioma y memoria del cliente salen de buildAgentContext, igual que en el
   * puente de OpenAI. Es lo que hace comparable la prueba.
   */
  private async prepararConversacion(): Promise<{ prompt: string; saludo?: string }> {
    const { env, botId, callerId } = this.deps;
    const db = this.db();
    // Estas tres no dependen entre sí y antes iban en fila, una espera de red
    // detrás de la otra, con el cliente escuchando silencio. Sale la más lenta
    // en vez de la suma. (buildAgentContext sí depende de conv.id, así que esa
    // se queda después — ver abajo.)
    const [conv, ajustes, canal] = await Promise.all([
      new ConversationsRepo(db, botId).getOrCreate(VOICE_CHANNEL, callerId),
      new SettingsRepo(db, botId).all(),
      new BotChannelsRepo(db).getByBotAndChannel(botId, VOICE_CHANNEL),
    ]);
    this.conversationId = conv.id;
    const conversationKey = conversationKeyOf(botId, VOICE_CHANNEL, callerId);

    // Guardar la transcripción es decisión del dueño (datos de sus clientes),
    // igual que en el puente de OpenAI. Sin habilitar, la llamada funciona
    // idéntico y no se persiste el texto.
    this.guardarTranscripcion = ajustes[SETTING_KEYS.voiceStoreTranscript] === "1";

    // paraVoz: si el dueño escribió un playbook de llamadas, gana sobre el de
    // chat. Los dos canales tienen presupuestos de prompt incompatibles —ver
    // SETTING_KEYS.voicePlaybook—, y aquí es donde se elige cuál se inyecta.
    const ctx = await buildAgentContext({
      env,
      botId,
      conversationId: conv.id,
      conversationKey,
      paraVoz: true,
    });
    this.timings = ctx.timings;
    // Se guardan para ejecutarlas cuando el agente las pida. Aquí SÍ vienen
    // las de MCP (buildAgentContext las agrega), aunque al registrar el agente
    // solo se declaren las estáticas.
    this.tools = ctx.tools;
    this.mcpToolNames = new Set(ctx.mcpToolNames);

    // transfer_to_human es SOLO de Voice — nunca pasa por buildTools (un chat
    // de WhatsApp no tiene una llamada que transferir), y solo se ofrece si el
    // dueño configuró un número destino: sin él, sería una herramienta que
    // falla garantizado y el agente la ofrecería igual.
    if (canal?.config.transferNumber) {
      this.tools = {
        ...this.tools,
        transfer_to_human: transferToHumanTool(env, botId, () => this.conversationId),
      };
    }

    // consultar_tarea (F-compañero): solo tiene sentido si este bot tiene al
    // menos un conector MCP — sin eso, ejecutarHerramienta() nunca delega
    // nada y la tool no tendría nada que consultar.
    if (this.mcpToolNames.size > 0) {
      this.tools = {
        ...this.tools,
        consultar_tarea: consultarTareaTool(() => ({
          tareas: this.tareasDelegadas,
          ultimaId: this.ultimaTareaDelegadaId,
        })),
      };
    }
    const prompt = [
      ctx.basePrompt,
      ...ctx.memoryBlocks,
      bloqueLlamadaEnCurso(callerId),
      // Qué NO puede hacer, derivado de las tools que de verdad tiene en ESTA
      // llamada. Va después de armar this.tools —que ya incluye
      // transfer_to_human si el dueño configuró número— para que la lista nunca
      // se desincronice: el día que lo configure, la prohibición se cae sola.
      bloqueLimites(Object.keys(this.tools)),
      VOICE_BEHAVIOR_ADDENDUM,
    ].join("\n\n");
    // El bot SALUDA PRIMERO — mismo criterio que el puente de OpenAI
    // (realtimeBridge.ts). Sin esto el agente espera callado a que el cliente
    // hable, y desde el teléfono eso se oye EXACTAMENTE igual que estar roto:
    // el dueño estuvo probando llamadas creyendo que el puente no servía,
    // cuando lo único que faltaba era que alguien abriera la boca primero.
    const saludo = resolveVoiceGreeting(
      ctx.cfg.voiceGreeting,
      ctx.bot?.business_name ?? env.BUSINESS_NAME ?? "",
      ctx.knownCustomerName,
    );
    return { prompt, saludo };
  }

  /**
   * Todo lo que ElevenLabs manda y el cliente no maneja explícitamente.
   *
   * Se registra SIEMPRE, no solo los errores: en una llamada muda, saber qué
   * eventos SÍ llegaron vale tanto como saber cuál falló. Lo importante aquí
   * es `conversation_initiation_metadata`, que trae el formato de audio que
   * ElevenLabs negoció de verdad — si no coincide con μ-law 8k, el audio de
   * las dos direcciones es ruido y nada más va a funcionar.
   */
  private eventoDeElevenLabs(tipo: string, evento: unknown): void {
    // El agente terminó de hablar: si había una transferencia esperando, este
    // es el momento — ya dijo lo que tenía que decir.
    if (tipo === "agent_response_complete" && this.transferenciaPendiente) {
      this.transferenciaPendiente = false;
      void this.hacerTransferencia();
    }
    const esError = tipo.includes("error") || tipo === "guardrail_triggered";
    const base = { botId: this.deps.botId, callSid: maskId(this.deps.callSid), tipo };
    if (esError || tipo === "conversation_initiation_metadata") {
      // Con detalle: son los dos que de verdad explican una llamada rota.
      logVoiceEvent("elevenlabs_evento", { ...base, detalle: JSON.stringify(evento).slice(0, 400) });
      return;
    }
    logVoiceEvent("elevenlabs_evento", base);
  }

  /**
   * Cuelga una llamada que se quedó sola.
   *
   * ElevenLabs cobra POR MINUTO, así que un cliente que deja el teléfono
   * descolgado es dinero corriendo hasta el tope de 30 minutos. El puente de
   * OpenAI ya tenía este freno; el de ElevenLabs nació sin él — y ahí el
   * descuido cuesta más, porque allá se paga por minuto de sesión y no por
   * tokens de lo que se dice.
   *
   * Mismos umbrales y mismas variables de entorno que el otro puente, para no
   * inventar un segundo juego de reglas que se desincronice.
   */
  private arrancarVigilanteDeSilencio(): void {
    const limite = Number(this.deps.env.VOICE_SILENCE_HANGUP_MS) || 45_000;
    const cada = Number(this.deps.env.VOICE_SILENCE_CHECK_INTERVAL_MS) || 5_000;
    this.vigilanteDeSilencio = setInterval(() => {
      if (this.cerrado) return;
      if (Date.now() - this.ultimaActividad < limite) return;
      logVoiceEvent("silence_hangup", {
        botId: this.deps.botId,
        callSid: maskId(this.deps.callSid),
        idleMs: Date.now() - this.ultimaActividad,
      });
      void this.close("silencio_prolongado");
    }, cada);
  }

  /**
   * Ejecuta una herramienta que pidió el agente y le devuelve el resultado.
   *
   * Es el MISMO `execute()` del AI SDK que usan el chat y el puente de OpenAI
   * — no hay una segunda implementación de agendar o capturar leads. Una cita
   * agendada por aquí escribe en las mismas tablas que una de WhatsApp.
   *
   * Nunca lanza: un fallo se le devuelve al agente como error para que se lo
   * diga al cliente. Callarse el error haría que confirme una cita que no se
   * agendó, y eso es peor que admitir que falló.
   */
  private async ejecutarHerramienta(llamada: {
    toolCallId: string;
    nombre: string;
    parametros: unknown;
  }): Promise<void> {
    const { nombre, toolCallId, parametros: parametrosCrudos } = llamada;
    logVoiceEvent("elevenlabs_tool_call", {
      botId: this.deps.botId,
      callSid: maskId(this.deps.callSid),
      tool: nombre,
    });

    const def = this.tools[nombre];
    if (!def?.execute) {
      logVoiceEvent("elevenlabs_tool_missing", { botId: this.deps.botId, tool: nombre });
      this.client?.sendToolResult(toolCallId, { error: "tool_not_available" }, true);
      return;
    }

    // Validar los argumentos contra el esquema de la tool, igual que hace el
    // AI SDK en el camino de texto. Aquí no lo hacía nadie, y por eso los
    // `.default()` de Zod nunca se aplicaban: un campo omitido por el modelo
    // llegaba como `undefined` hasta el INSERT y el driver de Postgres tiraba
    // "UNDEFINED_VALUE". Ver validarParametros.ts para el caso real.
    const validado = await validarParametros(def, parametrosCrudos);
    if (!validado.ok) {
      logVoiceEvent("elevenlabs_tool_argumentos_invalidos", {
        botId: this.deps.botId,
        callSid: maskId(this.deps.callSid),
        tool: nombre,
        motivo: validado.motivo,
      });
      // Con el motivo concreto el agente puede corregirse y volver a llamar
      // dentro de la misma llamada, en vez de rendirse con un error opaco.
      this.client?.sendToolResult(toolCallId, { error: "argumentos_invalidos", detalle: validado.motivo }, true);
      return;
    }
    const parametros = validado.valor;

    // Delegar en vez de encolar (F-compañero, portado del puente de OpenAI):
    // una tool MCP puede tardar varios segundos — un viaje real a un servidor
    // ajeno, no una consulta a nuestra propia base — y esperarla aquí deja al
    // cliente en silencio hasta TOOL_TIMEOUT_MS (8s). En vez de eso, se
    // dispara y la llamada sigue: el agente le dice al cliente que lo está
    // gestionando (ver <modo_voz> en voiceInstructions.ts) y usa
    // consultar_tarea más adelante — cuando el cliente pregunte, o antes de
    // despedirse — para confirmar el resultado real. Ningún otro tipo de tool
    // se delega: captureLead, scheduleAppointment, etc. son escrituras
    // rápidas a nuestra propia base y esperar por ellas no vale la vuelta de
    // "consultar" después.
    if (this.mcpToolNames.has(nombre)) {
      const tareaId = crypto.randomUUID();
      const tarea: TareaDelegada = { toolName: nombre, estado: "en_progreso", iniciadaEn: Date.now() };
      this.tareasDelegadas.set(tareaId, tarea);
      this.ultimaTareaDelegadaId = tareaId;

      void def.execute(parametros, {} as any).then(
        (resultado: unknown) => {
          const motivo = motivoDeFallo(resultado);
          const fallo = motivo !== null;
          tarea.estado = fallo ? "error" : "lista";
          tarea.resultado = resultado;
          if (motivo) {
            // Antes esto no se guardaba —`tarea.error` solo se llenaba cuando
            // la tool LANZABA— así que consultar_tarea contestaba "no se pudo
            // completar" y ahí se acababa el hilo: ni el agente sabía qué
            // corregir ni nosotros qué había pasado. Pasó el 2026-09-09: el
            // CRM rechazó un SELECT contra columnas inexistentes y el motivo
            // se perdió en el aire.
            tarea.error = pistaAccionable(motivo);
            logVoiceEvent("elevenlabs_tool_mcp_rechazada", {
              botId: this.deps.botId,
              callSid: maskId(this.deps.callSid),
              tool: nombre,
              motivo,
            });
          }
          void recordCallEvent(this.db(), this.deps.botId, this.callRowId, "call.tool_called", {
            tool: nombre,
            kind: "mcp",
            ok: !fallo,
            ...(motivo ? { motivo: motivo.slice(0, 300) } : {}),
          });
        },
        (e: unknown) => {
          tarea.estado = "error";
          // Opaco a propósito — igual que el camino síncrono de abajo: el
          // motivo REAL solo va al log, nunca a lo que consultar_tarea le
          // puede repetir al modelo (y de ahí, al cliente en voz alta).
          tarea.error = "tool_execution_failed";
          console.error(`[voice-elevenlabs] tool delegada "${nombre}" falló:`, e);
          void recordCallEvent(this.db(), this.deps.botId, this.callRowId, "call.tool_called", {
            tool: nombre,
            kind: "mcp",
            ok: false,
          });
        },
      );

      this.client?.sendToolResult(
        toolCallId,
        {
          estado: "en_progreso",
          tarea_id: tareaId,
          instruccion:
            "Se está procesando en segundo plano. NO digas que ya quedó hecho — avísale al cliente con naturalidad que lo estás gestionando, y usa consultar_tarea (con este tarea_id, o sin él para la más reciente) cuando el cliente pregunte o antes de despedirte, para confirmar el resultado real.",
        },
        false,
      );
      return;
    }

    // El mismo tope que el puente de OpenAI: una herramienta lenta no puede
    // dejar al cliente esperando en silencio indefinidamente.
    try {
      const resultado = await Promise.race([
        def.execute(parametros, {} as any),
        new Promise((_r, reject) => setTimeout(() => reject(new Error("tool_timeout")), TOOL_TIMEOUT_MS)),
      ]);
      // Una tool que NO lanza puede haber fallado igual: las del Agent Core
      // devuelven { error: "..." } en vez de tirar una excepción (es la misma
      // convención que ya usa transfer_to_human más abajo). Antes eso se
      // reportaba como éxito por partida doble, y las dos mentiras dolieron:
      //
      //  - En el evento quedaba ok:true, así que la bitácora decía que la
      //    herramienta había funcionado cuando no.
      //  - Y a ElevenLabs se le mandaba is_error:false, o sea que el agente
      //    recibía el fallo disfrazado de resultado bueno. Pasó en una llamada
      //    real: scheduleAppointment rechazó los datos, el agente lo leyó como
      //    éxito y le dijo al cliente "ya quedó agendada" — sin cita.
      const motivo = motivoDeFallo(resultado);

      // El prefijo de una tool MCP lo elige el dueño por conector (ver
      // connectors/mcpNaming.ts: "Vinqulia" → vinqulia_query) — nunca un
      // patrón fijo "mcp_algo". En la práctica una tool MCP real nunca llega
      // aquí (se va por la rama delegada de arriba), pero el chequeo se deja
      // correcto de todos modos en vez de asumir un prefijo que no existe.
      void recordCallEvent(this.db(), this.deps.botId, this.callRowId, "call.tool_called", {
        tool: nombre,
        kind: nombre === "searchKb" ? "rag" : this.mcpToolNames.has(nombre) ? "mcp" : "other",
        ok: motivo === null,
        ...(motivo ? { motivo } : {}),
      });
      if (motivo) {
        logVoiceEvent("elevenlabs_tool_rechazada", {
          botId: this.deps.botId,
          callSid: maskId(this.deps.callSid),
          tool: nombre,
          motivo,
          // QUÉ campos llegaron, nunca su contenido: para saber si el agente
          // omitió un dato obligatorio sin guardar datos del cliente en la
          // bitácora.
          camposRecibidos: camposConValor(parametros).join(","),
        });
      }

      // La transferencia NO se ejecuta aquí: primero el agente tiene que
      // terminar de decirle al cliente "te comunico con alguien". Cortarle la
      // llamada a media frase es peor que no transferir — el cliente se queda
      // sin entender qué pasó. Se ejecuta al cerrar la respuesta.
      if (nombre === "transfer_to_human" && motivo === null) {
        this.transferenciaPendiente = true;
      }

      // El tercer parámetro es is_error: sin él, ElevenLabs le entrega al
      // agente un fallo como si fuera un resultado bueno, y el agente le
      // promete al cliente algo que no ocurrió.
      this.client?.sendToolResult(toolCallId, resultado, motivo !== null);
    } catch (e) {
      const porTiempo = e instanceof Error && e.message === "tool_timeout";
      logVoiceEvent(porTiempo ? "elevenlabs_tool_timeout" : "elevenlabs_tool_failed", {
        botId: this.deps.botId,
        tool: nombre,
      });
      if (!porTiempo) console.error(`[voice-elevenlabs] tool "${nombre}" falló:`, e);
      // Motivo corto, nunca el stack: el agente lo lee para decirle algo
      // razonable al cliente, no para recitárselo.
      this.client?.sendToolResult(toolCallId, { error: porTiempo ? "timeout" : "tool_execution_failed" }, true);
    }
  }

  private audioHaciaTwilio(audioBase64: string): void {
    if (this.cerrado) return;
    this.ultimaActividad = Date.now();
    // La otra mitad del diagnóstico: sin esto solo se sabía que el audio del
    // cliente SALÍA, no si alguna vez volvía algo. "La llamada no se oye"
    // puede ser que ElevenLabs no hable, o que hable y no llegue a Twilio —
    // dos causas muy distintas que se veían idénticas desde afuera.
    if (!this.audioDelAgenteRecibido) {
      this.audioDelAgenteRecibido = true;
      logVoiceEvent("elevenlabs_audio_agente", {
        botId: this.deps.botId,
        callSid: maskId(this.deps.callSid),
      });
    }
    // La primera muestra de audio de un turno es lo que mide la latencia que
    // de verdad se oye: desde que el cliente calló hasta que el bot habla.
    if (this.finDeTurnoDelCliente != null) {
      const latencia = Date.now() - this.finDeTurnoDelCliente;
      this.finDeTurnoDelCliente = null;
      logVoiceEvent("response_started", {
        botId: this.deps.botId,
        callSid: maskId(this.deps.callSid),
        turnLatencyMs: latencia,
      });
      void recordCallEvent(this.db(), this.deps.botId, this.callRowId, "call.agent_turn", {
        status: "completed",
        turnLatencyMs: latencia,
        proveedor: "elevenlabs",
      });
      void new VoiceSessionsRepo(this.db(), this.deps.botId)
        .addResponseLatency(this.callRowId, latencia)
        .catch(() => {});
    }
    this.deps.sendToTwilio(buildMediaMessage(this.deps.streamSid, audioBase64));
  }

  /**
   * Barge-in. El `clear` a Twilio es obligatorio: sin él, Twilio sigue
   * reproduciendo lo que ya tiene en su buffer y el bot le habla encima al
   * cliente durante segundos — el mismo motivo por el que existe en el puente
   * de OpenAI.
   */
  private interrumpido(): void {
    this.metrics.interruptionCount++;
    this.deps.sendToTwilio(buildClearMessage(this.deps.streamSid));
    logVoiceEvent("barge_in", { botId: this.deps.botId, callSid: maskId(this.deps.callSid) });
  }

  private async persistirTurno(role: "user" | "assistant", text: string): Promise<void> {
    if (role === "user") this.finDeTurnoDelCliente = Date.now();
    if (!this.conversationId || !text.trim()) return;
    if (this.guardarTranscripcion) this.transcripcion.push({ role, text, at: Date.now() });
    await new MessagesRepo(this.db(), this.deps.botId)
      .append(this.conversationId, role, text)
      .catch((e) => console.error("[voice-elevenlabs] no se pudo persistir el turno:", e));
  }

  handleTwilioMedia(payloadBase64: string): void {
    // Se registra el PRIMER trozo nada más — uno cada 20 ms llenaría el log
    // en segundos. Lo que se quiere saber es si el audio del cliente llega a
    // salir hacia ElevenLabs, no cuántas veces.
    if (!this.audioDelClienteEnviado) {
      this.audioDelClienteEnviado = true;
      logVoiceEvent("elevenlabs_audio_cliente", {
        botId: this.deps.botId,
        callSid: maskId(this.deps.callSid),
      });
    }
    this.ultimaActividad = Date.now();
    this.client?.sendUserAudio(payloadBase64);
  }

  handleTwilioDtmf(_digit: string): void {
    // Sin uso todavía: el puente de OpenAI tampoco actúa sobre DTMF hoy.
  }

  async close(reason: string): Promise<void> {
    if (this.cerrado) return;
    this.cerrado = true;
    if (this.vigilanteDeSilencio) clearInterval(this.vigilanteDeSilencio);
    this.client?.close();
    logVoiceEvent("call_ended", {
      botId: this.deps.botId,
      callSid: maskId(this.deps.callSid),
      reason,
      proveedor: "elevenlabs",
    });
    // El costo, con la misma precisión que el otro puente — es lo único que
    // permite comparar los dos proveedores en /admin. ElevenLabs cobra POR
    // MINUTO y no por tokens, así que se estima con duración × tarifa: aquí el
    // prompt largo, que en Realtime era el costo dominante, no cuesta nada.
    await this.registrarCostos().catch((e) =>
      console.error("[voice-elevenlabs] no se pudo estimar el costo:", e),
    );

    // El CRM se pone al día con lo que se habló, igual que en texto — una
    // llamada no puede dejar menos rastro que un WhatsApp.
    await encolarAnalisisDeLlamada(this.deps.env, this.deps.botId, this.conversationId);
    // Comprobar contra la base lo que el bot afirmó haber hecho. Va aquí y no
    // en el analisis diferido porque no necesita esperar: los hechos ya estan
    // escritos, y si algo no cuadra el dueno se entera hoy, no manana.
    await verificarLlamada(this.deps.env, this.db(), this.deps.botId, this.callRowId, this.conversationId);

    await this.deps.voiceSession.end("completed", reason).catch((e: unknown) =>
      console.error("[voice-elevenlabs] no se pudo cerrar la sesión:", e),
    );
  }

  /**
   * Mueve la llamada al número humano. Si falla, la llamada NO se toca y el
   * cliente sigue con la IA — nunca se le deja colgado en el limbo.
   */
  private async hacerTransferencia(): Promise<void> {
    const base = { botId: this.deps.botId, callSid: maskId(this.deps.callSid) };
    const r = await transferirLlamadaViva(this.deps.env, {
      botId: this.deps.botId,
      callSid: this.deps.callSid,
    });
    const repo = new VoiceSessionsRepo(this.db(), this.deps.botId);
    if (!r.ok) {
      logVoiceEvent("transfer_failed", { ...base, reason: r.motivo });
      await repo.setTransferStatus(this.callRowId, "failed").catch(() => {});
      await recordCallEvent(this.db(), this.deps.botId, this.callRowId, "call.transferred", {
        phase: "failed",
        reason: r.motivo,
      }).catch(() => {});
      return;
    }
    logVoiceEvent("transfer_started", base);
    await repo.setTransferStatus(this.callRowId, "started").catch(() => {});
    await recordCallEvent(this.db(), this.deps.botId, this.callRowId, "call.transferred", {
      phase: "started",
    }).catch(() => {});
    // Twilio ya movió la llamada: este lado se cierra para no seguir
    // procesando (y cobrando) una llamada que ya no está con nosotros.
    void this.close("transferred");
  }

  private async registrarCostos(): Promise<void> {
    if (!this.callRowId) return;
    const db = this.db();
    const repo = new VoiceSessionsRepo(db, this.deps.botId);
    const [row, tarifaTelefonia] = await Promise.all([
      repo.getById(this.callRowId),
      resolveTelephonyCostPerMinute(db, this.deps.botId),
    ]);
    const durationMs = row ? Date.now() - row.started_at : 0;
    await repo.finalize(this.callRowId, {
      durationMs,
      estimatedAiCostUsd: estimateElevenLabsCost(durationMs),
      estimatedTelephonyCostUsd: estimateTelephonyCost(durationMs, tarifaTelefonia),
    });
    if (this.guardarTranscripcion && this.transcripcion.length > 0) {
      await repo.setTranscript(this.callRowId, this.transcripcion).catch((e) =>
        console.error("[voice-elevenlabs] no se pudo guardar la transcripción:", e),
      );
    }
  }
}
