/**
 * De cara a Twilio, la voz vive en OTRO servidor que el panel.
 *
 * Esto existe por un error real: el panel mostraba su propia URL como webhook
 * de "A CALL COMES IN". El dueño la pegaba, Twilio la llamaba, el webhook
 * contestaba TwiML — y la llamada moría al abrir el media stream contra un
 * despliegue (Vercel) que no puede sostener un WebSocket. Solo se veía
 * marcando, y sonaba a que el número estaba mal.
 */
import { describe, it, expect } from "vitest";
import { voiceBaseUrl } from "../../src/channels/voice/baseUrl";
import type { Env } from "../../src/env";

const env = (dashboard: string, voz?: string) =>
  ({ DASHBOARD_BASE_URL: dashboard, VOICE_PUBLIC_BASE_URL: voz }) as unknown as Env;

describe("voiceBaseUrl", () => {
  it("con servidor de voz aparte, manda el de voz", () => {
    expect(voiceBaseUrl(env("https://app.nodiagents.com", "https://nodia-voice.fly.dev"))).toBe(
      "https://nodia-voice.fly.dev",
    );
  });

  it("sin servidor de voz aparte (instalación de un solo proceso), el de siempre", () => {
    expect(voiceBaseUrl(env("https://mi-bot.example.com"))).toBe("https://mi-bot.example.com");
    expect(voiceBaseUrl(env("https://mi-bot.example.com", "   "))).toBe("https://mi-bot.example.com");
  });

  it("sin barra final: se concatena un path detrás", () => {
    expect(voiceBaseUrl(env("https://x.com/", "https://voz.example.com/"))).toBe("https://voz.example.com");
  });
});
