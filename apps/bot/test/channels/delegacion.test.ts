/**
 * Qué tool de MCP se espera y cuál se delega.
 *
 * La llamada del 2026-09-09 15:35, entera:
 *   33s  el agente llama vinqulia_get_schema  → "en_progreso"
 *   34s  consultar_tarea                      → "en_progreso" (aún no)
 *   35s  el esquema llega... y nadie lo recoge
 *   57s  sin esquema, vuelve a adivinar: SELECT ... FROM handoff_human
 *
 * Preguntó un segundo antes de tiempo y no volvió a preguntar. Delegar una
 * LECTURA obliga al agente a un "pregunta después" que en una llamada, con el
 * cliente esperando, no termina de bailar. Su respuesta es justo lo que
 * necesita para poder contestar.
 */
import { describe, it, expect } from "vitest";
import { esLecturaMcp, ESPERA_LECTURA_MCP_MS } from "../../src/channels/voice/delegacion";

describe("esLecturaMcp", () => {
  it("las lecturas se esperan — son las que traen el dato que hace falta", () => {
    for (const t of [
      "vinqulia_query",
      "vinqulia_get_schema",
      "vinqulia_display_task_list",
      "zendesk_searchTickets",
      "crm_listar_contactos",
      "algo_describe",
    ]) {
      expect(esLecturaMcp(t), t).toBe(true);
    }
  });

  it("las escrituras se siguen delegando — ahí el agente no necesita el contenido", () => {
    for (const t of ["vinqulia_mutate", "vinqulia_complete_task", "crm_create_contact", "algo_send_email"]) {
      expect(esLecturaMcp(t), t).toBe(false);
    }
  });

  it("si el nombre dice las dos cosas, manda la escritura", () => {
    // `get_or_create` escribe: tratarlo como lectura lo metería en el camino
    // que espera, y una escritura lenta sí puede colgar el turno.
    expect(esLecturaMcp("vinqulia_get_or_create_contact")).toBe(false);
    expect(esLecturaMcp("crm_upsert_and_list")).toBe(false);
  });

  it("un nombre que no dice nada NO se espera: se delega, como antes", () => {
    // Ante la duda, el comportamiento de siempre. Esperar algo desconocido
    // que resulte lento es lo único que puede empeorar una llamada.
    expect(esLecturaMcp("vinqulia_algo_raro")).toBe(false);
  });

  it("el tope de espera cabe bajo los 15s que aguanta ElevenLabs", () => {
    // Quien debe rendirse primero es el puente, que sabe DECIR qué pasó.
    expect(ESPERA_LECTURA_MCP_MS).toBeLessThan(15_000);
    // Y por encima de los 6s peor caso que medimos en producción.
    expect(ESPERA_LECTURA_MCP_MS).toBeGreaterThan(6_000);
  });
});
