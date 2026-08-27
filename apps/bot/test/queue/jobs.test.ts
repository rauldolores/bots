// La cola que reemplaza al Durable Object. Estos tests cubren las tres cosas
// que el DO daba gratis y que ahora hay que garantizar a mano: el debounce del
// buffer, la serialización por conversación, y que ningún mensaje se pierda.
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/pgSetup";
import { AgentJobsRepo, AGENT_JOB_LEASE_MS, PENDING_CLAIM_TTL_MS } from "../../src/queue/jobs";
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

/**
 * Bug real, en el widget de un cliente: escribió, el turno arrancó y se murió
 * a la mitad (timeout), y nadie le contestó NUNCA. La causa era que
 * drainPending() borraba el texto antes de que el turno respondiera — el
 * reintento encontraba el buffer vacío y se iba callado.
 */
describe("el buffer no se pierde si el turno falla", () => {
  it("drenar MARCA los mensajes, no los borra — siguen ahí por si hay que reintentar", async () => {
    await jobs.addPending("telegram:u1", "hola");
    await jobs.drainPending("telegram:u1");

    const filas = await db.all<{ claimed_at: number | null }>(
      "SELECT claimed_at FROM pending_messages WHERE conversation_key = ?",
      ["telegram:u1"],
    );
    expect(filas).toHaveLength(1);
    expect(filas[0].claimed_at).not.toBeNull();
  });

  it("tras responder, clearClaimedPending sí los tira", async () => {
    await jobs.addPending("telegram:u1", "hola");
    await jobs.drainPending("telegram:u1");
    await jobs.clearClaimedPending("telegram:u1");

    expect(await db.all("SELECT id FROM pending_messages WHERE conversation_key = ?", ["telegram:u1"])).toHaveLength(0);
  });

  it("si el turno falla, releaseClaimedPending los devuelve y el reintento SÍ los ve", async () => {
    await jobs.addPending("telegram:u1", "quiero informes");
    const primerIntento = await jobs.drainPending("telegram:u1");
    expect(primerIntento.map((m) => m.text)).toEqual(["quiero informes"]);

    // El turno explotó: nada de clearClaimedPending.
    await jobs.releaseClaimedPending("telegram:u1");

    const reintento = await jobs.drainPending("telegram:u1");
    expect(reintento.map((m) => m.text)).toEqual(["quiero informes"]);
  });

  it("un mensaje que llega DURANTE el turno no se tira al limpiar — se responde en el siguiente", async () => {
    await jobs.addPending("telegram:u1", "primero");
    await jobs.drainPending("telegram:u1");
    // El cliente sigue escribiendo mientras el bot "piensa" (típico del widget).
    await jobs.addPending("telegram:u1", "segundo");

    await jobs.clearClaimedPending("telegram:u1");

    const siguiente = await jobs.drainPending("telegram:u1");
    expect(siguiente.map((m) => m.text)).toEqual(["segundo"]);
  });

  it("releaseClaimedPending no toca lo que llegó después (no lo re-responde dos veces)", async () => {
    await jobs.addPending("telegram:u1", "primero");
    await jobs.drainPending("telegram:u1");
    await jobs.addPending("telegram:u1", "segundo");

    await jobs.releaseClaimedPending("telegram:u1");

    const reintento = await jobs.drainPending("telegram:u1");
    expect(reintento.map((m) => m.text)).toEqual(["primero", "segundo"]);
  });

  it("una marca vieja (proceso muerto sin soltar nada) se puede retomar sola", async () => {
    await jobs.addPending("telegram:u1", "hola");
    await jobs.drainPending("telegram:u1");
    // Nadie soltó ni limpió: el proceso murió de golpe.
    expect(await jobs.drainPending("telegram:u1")).toEqual([]);

    await db.run(
      "UPDATE pending_messages SET claimed_at = (EXTRACT(EPOCH FROM now()) * 1000)::bigint - ? WHERE conversation_key = ?",
      [PENDING_CLAIM_TTL_MS + 1000, "telegram:u1"],
    );
    expect((await jobs.drainPending("telegram:u1")).map((m) => m.text)).toEqual(["hola"]);
  });

  it("los mensajes salen en orden de llegada — se unen con \\n para armar el turno", async () => {
    await jobs.addPending("telegram:u1", "uno");
    await jobs.addPending("telegram:u1", "dos");
    await jobs.addPending("telegram:u1", "tres");
    expect((await jobs.drainPending("telegram:u1")).map((m) => m.text)).toEqual(["uno", "dos", "tres"]);
  });

  it("limpiar/soltar solo afecta a su conversación", async () => {
    await jobs.addPending("telegram:u1", "mío");
    await jobs.addPending("whatsapp:u2", "ajeno");
    await jobs.drainPending("telegram:u1");
    await jobs.drainPending("whatsapp:u2");

    await jobs.clearClaimedPending("telegram:u1");

    await jobs.releaseClaimedPending("whatsapp:u2");
    expect((await jobs.drainPending("whatsapp:u2")).map((m) => m.text)).toEqual(["ajeno"]);
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
