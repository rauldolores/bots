/**
 * Qué corre en cada cron. Antes el watchdog y los seguimientos colgaban de un
 * cron "horario" que en Vercel/Cloudflare no existía y solo corrían a las 3am.
 * Ahora: watchdog en cada vuelta de 5 min, seguimientos en la primera de cada hora.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const llamadas: string[] = [];
vi.mock("../../src/estado/revisar", () => ({ revisarEstadoServicio: async () => { llamadas.push("estado"); return []; } }));
vi.mock("../../src/watchdog", () => ({ checkBotHealth: async () => { llamadas.push("watchdog"); return { failures: 0, alerted: false }; } }));
vi.mock("../../src/followup/run", () => ({ runFollowups: async () => { llamadas.push("seguimientos"); } }));
vi.mock("../../src/queue/tick", () => ({ tick: async () => { llamadas.push("tick"); return {}; } }));

const { runScheduledJobs, ESTADO_CRON, TICK_CRON } = await import("../../src/app");

const env = {} as never;
const a = (hhmm: string) => Date.parse(`2026-10-27T${hhmm}:00Z`);

beforeEach(() => {
  llamadas.length = 0;
});

describe("runScheduledJobs", () => {
  it("cada 5 min: estado del servicio y watchdog, sin tocar la cola", async () => {
    await runScheduledJobs(env, ESTADO_CRON, a("14:35"));
    expect(llamadas).toEqual(["estado", "watchdog"]);
  });

  it("la vuelta de 5 min que cae al inicio de la hora también corre los seguimientos", async () => {
    await runScheduledJobs(env, ESTADO_CRON, a("15:00"));
    expect(llamadas).toEqual(["estado", "watchdog", "seguimientos"]);
  });

  it("el de cada minuto solo mira la cola", async () => {
    await runScheduledJobs(env, TICK_CRON, a("15:00"));
    expect(llamadas).toEqual(["tick"]);
  });
});
