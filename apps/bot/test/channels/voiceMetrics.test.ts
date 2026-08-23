import { describe, it, expect } from "vitest";
import { createCallMetrics, beginTurn, timeToFirstAudioMs } from "../../src/channels/voice/metrics";

describe("métricas de latencia de una llamada", () => {
  it("timeToFirstAudioMs es null hasta que hay response_started Y first_audio_delta", () => {
    const m = createCallMetrics();
    expect(timeToFirstAudioMs(m)).toBeNull();
    m.currentTurn.responseStartedAt = 1000;
    expect(timeToFirstAudioMs(m)).toBeNull();
    m.currentTurn.firstAudioDeltaAt = 1240;
    expect(timeToFirstAudioMs(m)).toBe(240);
  });

  it("beginTurn reinicia los timestamps del turno pero conserva userTurnDetectedAt", () => {
    const m = createCallMetrics();
    m.currentTurn.userTurnDetectedAt = 500;
    m.currentTurn.responseStartedAt = 600;
    m.currentTurn.firstAudioDeltaAt = 650;
    m.currentTurn.responseCompletedAt = 900;

    beginTurn(m);

    expect(m.currentTurn.userTurnDetectedAt).toBe(500);
    expect(m.currentTurn.responseStartedAt).toBeNull();
    expect(m.currentTurn.firstAudioDeltaAt).toBeNull();
    expect(m.currentTurn.responseCompletedAt).toBeNull();
  });
});
