// La escalera de reintentos del LLM, compartida.
//
// Vivía embebida dentro de runAgentTurnCore() (agent/turn.ts) y por eso solo
// la tenía el turno de texto: el analizador, el flywheel, el seguimiento y —
// desde F8 — las habilidades por API se quedaban sin ella, así que un
// rate-limit transitorio del proveedor les tronaba de una.
//
// El orden importa y es el que ya estaba probado en producción:
//   1. intento normal
//   2. respiro con jitter + reintento al MISMO modelo (un 429 en ráfaga suele
//      resolverse solo)
//   3. degradar al modelo automático del MISMO proveedor (cubre el caso de un
//      modelo fijado a mano que el proveedor retiró)
//   4. cambiar de proveedor, con un segundo intento
import type { Env } from "../env";
import { createModel, fallbackModel, degradedModelFor, type LlmOverrides } from "./provider";
import type { Tier } from "../upgrade/modelSelector";

const backoff = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FailoverInput<T> {
  env: Env;
  tier: Tier;
  llm: LlmOverrides;
  /** Para los logs — de dónde viene la llamada ("runAgentTurnCore", "skill:calificar-lead"…). */
  label: string;
  /** El intento en sí. Recibe el modelo del AI SDK a usar. */
  attempt: (model: any) => Promise<T>;
  /**
   * Se llama cuando el modelo fijado a mano falló y se degradó al automático
   * del mismo proveedor — el turno de texto lo aprovecha para dejar el aviso
   * en settings y que el panel lo muestre.
   */
  onDegraded?: (info: { fromModelId: string; toModelId: string; provider: string }) => Promise<void>;
}

export type FailoverResult<T> =
  | { ok: true; value: T; modelId: string }
  | { ok: false; error: unknown };

export async function runWithFailover<T>(input: FailoverInput<T>): Promise<FailoverResult<T>> {
  const { env, tier, llm, label, attempt, onDegraded } = input;
  const primary = createModel(env, tier, llm);

  try {
    return { ok: true, value: await attempt(primary.model), modelId: primary.modelId };
  } catch (e) {
    console.error(`[${label}] intento inicial falló:`, e);

    const fb = fallbackModel(env, tier, primary.provider);
    const degraded = degradedModelFor(env, tier, llm, primary);
    let lastError: unknown = e;

    await backoff(2000 + Math.floor(Math.random() * 1500));
    try {
      return { ok: true, value: await attempt(primary.model), modelId: primary.modelId };
    } catch (e1) {
      lastError = e1;
      console.error(`[${label}] reintento al primario falló:`, e1);
    }

    if (degraded) {
      try {
        const value = await attempt(degraded.model);
        console.warn(
          `[${label}] modelo fijado "${primary.modelId}" falló — degradado a "${degraded.modelId}" (mismo proveedor)`,
        );
        await onDegraded?.({
          fromModelId: primary.modelId,
          toModelId: degraded.modelId,
          provider: primary.provider,
        }).catch((err) => console.warn(`[${label}] no se pudo guardar el aviso de degradado:`, err));
        return { ok: true, value, modelId: degraded.modelId };
      } catch (e2) {
        lastError = e2;
        console.error(`[${label}] degradado al mismo proveedor falló:`, e2);
      }
    }

    if (fb) {
      console.warn(`[${label}] failover ${primary.provider} → ${fb.provider}/${fb.modelId}`);
      try {
        return { ok: true, value: await attempt(fb.model), modelId: fb.modelId };
      } catch (e3) {
        lastError = e3;
        console.error(`[${label}] proveedor alterno falló:`, e3);
        await backoff(2500 + Math.floor(Math.random() * 1500));
        try {
          return { ok: true, value: await attempt(fb.model), modelId: fb.modelId };
        } catch (e4) {
          lastError = e4;
          console.error(`[${label}] reintento del alterno falló:`, e4);
        }
      }
    }

    return { ok: false, error: lastError };
  }
}
