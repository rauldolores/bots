// Timestamps y contadores de una llamada — para observabilidad y para
// calcular las métricas de F7 fase 6:
//
//   time_to_first_audio  — responseStartedAt → firstAudioDeltaAt (cuánto
//                           tarda el bot en empezar a "hablar" desde que
//                           arrancó a pensar la respuesta).
//   turn_latency          — userTurnDetectedAt → responseStartedAt (cuánto
//                           tarda el bot en EMPEZAR a responder desde que el
//                           cliente terminó de hablar — lo que el cliente
//                           percibe como "¿me está escuchando?").
//   response_duration     — responseStartedAt → responseCompletedAt (cuánto
//                           dura la respuesta hablada completa).
//   interruption_count    — cuántas veces el cliente interrumpió al bot en
//                           esta llamada (barge-in).
//   interruption_latency  — última vez que se interrumpió: cuánto tardó
//                           Realtime en CONFIRMAR la cancelación
//                           (response.done con status "cancelled") desde que
//                           se la pedimos. El corte de audio hacia Twilio es
//                           inmediato y NO depende de este número — es solo
//                           observabilidad de qué tan sincronizado está el
//                           servidor, no una condición para cortar el audio.
//
// userTurnDetectedAt se marca en speech_STOPPED (fin del turno del cliente),
// no en speech_started (eso es el inicio — sirve para detectar barge-in, no
// para medir cuánto tardamos en contestar).
export interface CallMetrics {
  callStartedAt: number | null;
  firstAudioReceivedAt: number | null;
  interruptionCount: number;
  lastInterruptionLatencyMs: number | null;
  currentTurn: {
    userTurnDetectedAt: number | null;
    responseStartedAt: number | null;
    firstAudioDeltaAt: number | null;
    responseCompletedAt: number | null;
  };
}

export function createCallMetrics(): CallMetrics {
  return {
    callStartedAt: null,
    firstAudioReceivedAt: null,
    interruptionCount: 0,
    lastInterruptionLatencyMs: null,
    currentTurn: { userTurnDetectedAt: null, responseStartedAt: null, firstAudioDeltaAt: null, responseCompletedAt: null },
  };
}

/** Se llama al arrancar cada respuesta nueva — limpia los timestamps del turno anterior para no mezclar mediciones entre turnos. Conserva userTurnDetectedAt: ya se marcó en speech_stopped, justo antes de que Realtime dispare response.created. */
export function beginTurn(m: CallMetrics): void {
  m.currentTurn = {
    userTurnDetectedAt: m.currentTurn.userTurnDetectedAt,
    responseStartedAt: null,
    firstAudioDeltaAt: null,
    responseCompletedAt: null,
  };
}

/** ms entre "empezó a generar la respuesta" y "llegó el primer chunk de audio". null si falta alguno de los dos. */
export function timeToFirstAudioMs(m: CallMetrics): number | null {
  const { responseStartedAt, firstAudioDeltaAt } = m.currentTurn;
  if (responseStartedAt == null || firstAudioDeltaAt == null) return null;
  return firstAudioDeltaAt - responseStartedAt;
}

/** ms entre "el cliente terminó de hablar" y "el bot empezó a responder". null si falta alguno de los dos. */
export function turnLatencyMs(m: CallMetrics): number | null {
  const { userTurnDetectedAt, responseStartedAt } = m.currentTurn;
  if (userTurnDetectedAt == null || responseStartedAt == null) return null;
  return responseStartedAt - userTurnDetectedAt;
}

/** ms que duró la respuesta hablada completa. null si todavía no termina (o nunca llegó a empezar). */
export function responseDurationMs(m: CallMetrics): number | null {
  const { responseStartedAt, responseCompletedAt } = m.currentTurn;
  if (responseStartedAt == null || responseCompletedAt == null) return null;
  return responseCompletedAt - responseStartedAt;
}
