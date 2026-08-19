import type { NichePack } from "./types";
import { generico } from "./generico";

export type { NichePack, NicheColumn } from "./types";

// Registro de packs. Agregar un nicho = importar su archivo y sumarlo aquí.
const PACKS: Record<string, NichePack> = {
  generico,
};

/**
 * Resuelve el pack activo desde bots.niche (F3: ya no es env.BOT_NICHE).
 * Nicho ausente/desconocido → genérico.
 */
export function getNiche(niche: string | null | undefined): NichePack {
  const id = (niche ?? "").trim().toLowerCase();
  return PACKS[id] ?? generico;
}
