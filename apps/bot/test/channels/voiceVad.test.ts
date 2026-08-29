// Regresión del reporte de la llamada real (2026-08-29): "hace preguntas y el
// bot solo se contesta... y presupone respuestas y sigue hablando".
//
// La causa no era el prompt (el addendum de voz YA decía "no te contestes a ti
// mismo") sino el VAD: con 400ms de silencio, la pausa natural de alguien que
// está pensando se leía como "ya terminó" y, por create_response:true, OpenAI
// le pedía un turno nuevo al modelo. El modelo no estaba eligiendo hablar.
import { describe, it, expect } from "vitest";
import { DEFAULT_VAD_SILENCE_MS, normalizeVadSilenceMs } from "../../src/channels/voice/vad";

describe("VAD de la llamada: cuánto espera antes de dar el turno por terminado", () => {
  it("el default deja espacio para una pausa de duda — nunca vuelve a los 400ms que causaron el reporte", () => {
    // 400ms es menos que "mi empresa es... eh...". Este piso es el arreglo:
    // si alguien lo vuelve a bajar buscando barge-in rápido, esta prueba lo
    // detiene. El barge-in NO depende de este número (es threshold +
    // interrupt_response), así que bajarlo no compra nada y sí rompe el turno.
    expect(DEFAULT_VAD_SILENCE_MS).toBeGreaterThanOrEqual(600);
  });

  it("respeta lo que el dueño configuró en el panel", () => {
    expect(normalizeVadSilenceMs(450)).toBe(450);
    expect(normalizeVadSilenceMs(1000)).toBe(1000);
  });

  it("un valor ausente o corrupto cae al default en vez de tumbar la llamada", () => {
    // El panel guarda texto libre y el puente hace Number(...) — un campo
    // vacío, un "abc" pegado a mano, o una llave que nunca se guardó llegan
    // aquí como undefined/NaN. Una llamada telefónica en curso no es lugar
    // para descubrirlo.
    expect(normalizeVadSilenceMs(undefined)).toBe(DEFAULT_VAD_SILENCE_MS);
    expect(normalizeVadSilenceMs(Number("abc"))).toBe(DEFAULT_VAD_SILENCE_MS);
    expect(normalizeVadSilenceMs(Number.POSITIVE_INFINITY)).toBe(DEFAULT_VAD_SILENCE_MS);
  });

  it("acota los extremos: ni un valor que reviva el bug, ni uno que deje al cliente esperando", () => {
    expect(normalizeVadSilenceMs(10)).toBe(200);
    expect(normalizeVadSilenceMs(30_000)).toBe(2000);
  });
});
