// La cola que reemplaza al Durable Object. Estos tests cubren las tres cosas
// que el DO daba gratis y que ahora hay que garantizar a mano: el debounce del
// buffer, la serialización por conversación, y que ningún mensaje se pierda.
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/pgSetup";
import { AgentJobsRepo, AGENT_JOB_LEASE_MS } from "../../src/queue/jobs";
import type { Db } from "../../src/db/client";

let db: Db;
let jobs: AgentJobsRepo;

beforeEach(async () => {
  db = await createTestDb();
  jobs = new AgentJobsRepo(db);
});

/** Empuja el trabajo al pasado para que el tick lo vea vencido, sin esperar. */
async function vencer(key: string, msEnElPasado = 1000) {
  await db.run(
    "UPDATE agent_jobs SET run_after = (EXTRACT(EPOCH FROM now()) * 1000)::bigint - ? WHERE conversation_key = ?",
    [msEnElPasado, key],
  );
}

describe("schedule — el debounce", () => {
  it("no encola dos trabajos para la misma conversación", async () => {
    await jobs.schedule("telegram:u1", 15_000);
    await jobs.schedule("telegram:u1", 15_000);
    await jobs.schedule("telegram:u1", 15_000);

    const filas = await db.all("SELECT conversation_key FROM agent_jobs");
    expect(filas).toHaveLength(1);
  });

  it("cada mensaje EMPUJA la hora de respuesta hacia adelante", async () => {
    await jobs.schedule("telegram:u1", 1_000);
    const primera = await db.first<{ run_after: number }>(
      "SELECT run_after FROM agent_jobs WHERE conversation_key = ?",
      ["telegram:u1"],
    );

    await jobs.schedule("telegram:u1", 60_000);
    const segunda = await db.first<{ run_after: number }>(
      "SELECT run_after FROM agent_jobs WHERE conversation_key = ?",
      ["telegram:u1"],
    );

    // Esto es exactamente lo que hacía setAlarm(): reprogramar, no acumular.
    expect(segunda!.run_after).toBeGreaterThan(primera!.run_after);
  });

  it("conversaciones distintas no se estorban", async () => {
    await jobs.schedule("telegram:u1", 1000);
    await jobs.schedule("whatsapp:u2", 1000);

    expect(await db.all("SELECT conversation_key FROM agent_jobs")).toHaveLength(2);
  });
});

describe("claimDue — la serialización", () => {
  it("no devuelve trabajos que aún no vencen", async () => {
    await jobs.schedule("telegram:u1", 60_000);
    expect(await jobs.claimDue(10)).toEqual([]);
  });

  it("devuelve los vencidos", async () => {
    await jobs.schedule("telegram:u1", 0);
    await vencer("telegram:u1");
    expect(await jobs.claimDue(10)).toEqual(["telegram:u1"]);
  });

  it("una conversación ya tomada NO se vuelve a tomar", async () => {
    await jobs.schedule("telegram:u1", 0);
    await vencer("telegram:u1");

    expect(await jobs.claimDue(10)).toEqual(["telegram:u1"]);
    // Este es el punto: sin esto, dos ticks responderían dos veces al mismo
    // cliente — justo lo que el Durable Object impedía por construcción.
    expect(await jobs.claimDue(10)).toEqual([]);
  });

  it("recupera un trabajo cuyo lease venció (proceso muerto a media respuesta)", async () => {
    await jobs.schedule("telegram:u1", 0);
    await vencer("telegram:u1");
    await jobs.claimDue(10);

    // Simula que quien lo tomó murió hace más del lease.
    await db.run(
      "UPDATE agent_jobs SET locked_at = (EXTRACT(EPOCH FROM now()) * 1000)::bigint - ? WHERE conversation_key = ?",
      [AGENT_JOB_LEASE_MS + 60_000, "telegram:u1"],
    );

    expect(await jobs.claimDue(10)).toEqual(["telegram:u1"]);
  });

  it("respeta el límite", async () => {
    for (const k of ["a:1", "b:2", "c:3"]) {
      await jobs.schedule(k, 0);
      await vencer(k);
    }
    expect(await jobs.claimDue(2)).toHaveLength(2);
  });

  it("cuenta los intentos", async () => {
    await jobs.schedule("telegram:u1", 0);
    await vencer("telegram:u1");
    await jobs.claimDue(10);
    expect(await jobs.attemptsOf("telegram:u1")).toBe(1);
  });
});

describe("pending — el buffer", () => {
  it("guarda los mensajes en orden y los saca todos juntos", async () => {
    await jobs.addPending("telegram:u1", "hola");
    await jobs.addPending("telegram:u1", "estás?");
    await jobs.addPending("telegram:u1", "necesito una cita");

    const salida = await jobs.drainPending("telegram:u1");
    expect(salida.map((m) => m.text)).toEqual(["hola", "estás?", "necesito una cita"]);
  });

  it("drenar deja el buffer vacío", async () => {
    await jobs.addPending("telegram:u1", "hola");
    await jobs.drainPending("telegram:u1");
    expect(await jobs.drainPending("telegram:u1")).toEqual([]);
  });

  it("solo drena la conversación pedida", async () => {
    await jobs.addPending("telegram:u1", "mío");
    await jobs.addPending("whatsapp:u2", "ajeno");

    await jobs.drainPending("telegram:u1");
    expect(await jobs.drainPending("whatsapp:u2")).toHaveLength(1);
  });
});

describe("complete y fail", () => {
  it("complete borra el trabajo", async () => {
    await jobs.schedule("telegram:u1", 0);
    await jobs.complete("telegram:u1");
    expect(await db.all("SELECT conversation_key FROM agent_jobs")).toHaveLength(0);
  });

  it("fail suelta el lease y reprograma, para que otro tick lo reintente", async () => {
    await jobs.schedule("telegram:u1", 0);
    await vencer("telegram:u1");
    await jobs.claimDue(10);

    await jobs.fail("telegram:u1", "el LLM se cayó", 30_000);

    const fila = await db.first<{ locked_at: number | null; last_error: string }>(
      "SELECT locked_at, last_error FROM agent_jobs WHERE conversation_key = ?",
      ["telegram:u1"],
    );
    expect(fila!.locked_at).toBeNull();
    expect(fila!.last_error).toBe("el LLM se cayó");
    // Reprogramado al futuro: no se vuelve a tomar de inmediato.
    expect(await jobs.claimDue(10)).toEqual([]);
  });
});
