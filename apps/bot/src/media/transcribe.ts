// Transcripción de notas de voz, con proveedor intercambiable (decisión D3).
//
// En Cloudflare usa Workers AI (Whisper), que no cuesta llave aparte. Fuera de
// Cloudflare no existe ese binding, así que sale por la API de OpenAI.

import type { Env } from "../env";

export interface TranscriptionResult {
  text: string;
  durationSeconds?: number;
}

export async function transcribeAudio(
  audioUrl: string,
  env: Env,
): Promise<TranscriptionResult> {
  const res = await fetch(audioUrl);
  if (!res.ok) throw new Error(`audio fetch failed: ${res.status}`);
  const buffer = await res.arrayBuffer();

  if (env.AI) return transcribeConWorkersAi(buffer, env);
  if (env.OPENAI_API_KEY) return transcribeConOpenAi(buffer, env);

  throw new Error(
    "No hay proveedor de transcripción: define OPENAI_API_KEY, o corre en Cloudflare con el binding AI.",
  );
}

async function transcribeConWorkersAi(
  buffer: ArrayBuffer,
  env: Env,
): Promise<TranscriptionResult> {
  // whisper-large-v3-turbo espera la cadena en base64 en `audio` (según la doc
  // de Workers AI), NO un arreglo de bytes crudo. nodejs_compat está activo
  // (ver wrangler.toml), así que Buffer existe, igual que en el ejemplo oficial.
  const base64 = Buffer.from(buffer).toString("base64");
  const result = await env.AI!.run("@cf/openai/whisper-large-v3-turbo" as any, {
    audio: base64,
  } as any);
  return { text: (result as any).text ?? "" };
}

async function transcribeConOpenAi(
  buffer: ArrayBuffer,
  env: Env,
): Promise<TranscriptionResult> {
  // El endpoint es multipart. El nombre del archivo importa: OpenAI deduce el
  // formato de la extensión, y los canales mandan las notas de voz en ogg/opus.
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "audio/ogg" }), "nota.ogg");
  form.append("model", env.OPENAI_TRANSCRIBE_MODEL ?? "whisper-1");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`OpenAI transcription ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const json = (await res.json()) as { text?: string };
  return { text: json.text ?? "" };
}
