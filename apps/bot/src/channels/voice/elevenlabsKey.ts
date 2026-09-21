// De quién es la llave de ElevenLabs con la que se atienden las llamadas.
//
// Antes cada bot tenía que traer la suya (voice_elevenlabs_api_key) y sin
// ella el teléfono no contestaba. Con los minutos de voz incluidos en el
// plan, la llave es de Kontrolia y va en el entorno (ELEVENLABS_API_KEY):
// el dueño elige voz y saludo, y nada más.
//
// La del bot, si existe, sigue ganando: sirve para Enterprise (su propia
// cuenta, sus propias voces) y para no romper a quien ya la había guardado.
import type { Env } from "../../env";
import { SETTING_KEYS } from "../../db/settings";
import { hayCupo, LIMITES, type ResultadoDeCupo } from "../../billing/kontrolia";

export type OrigenDeLlave = "propia" | "kontrolia";

export function llaveDeElevenLabs(
  env: Pick<Env, "ELEVENLABS_API_KEY">,
  settings: Record<string, string>,
): { apiKey: string; origen: OrigenDeLlave } | null {
  const propia = settings[SETTING_KEYS.voiceElevenLabsApiKey]?.trim();
  if (propia) return { apiKey: propia, origen: "propia" };
  const nuestra = (env.ELEVENLABS_API_KEY ?? "").trim();
  if (nuestra) return { apiKey: nuestra, origen: "kontrolia" };
  return null;
}

/**
 * ¿El plan de la organización trae voz? Es el límite "llamadas" (minutos al
 * mes): 0 = sin voz (Impulso), null = sin tope, sin dato = no es el SaaS o
 * el auth-server no contestó — y entonces sí, como siempre.
 *
 * Se usa para NO ofrecer la voz en el panel ni crear agentes en ElevenLabs
 * para quien no la tiene; que la llamada se cuelgue cuando no hay minutos ya
 * lo hace webhook.ts.
 */
export async function vozIncluidaEnElPlan(
  env: Env,
  organizationId: string | null | undefined,
): Promise<{ incluida: boolean; minutos: number | null; cupo: ResultadoDeCupo | null }> {
  if (!organizationId) return { incluida: true, minutos: null, cupo: null };
  const cupo = await hayCupo(env, organizationId, LIMITES.llamadas);
  const limite = cupo.usage?.limit ?? null;
  return { incluida: limite === null || limite > 0, minutos: limite, cupo };
}
