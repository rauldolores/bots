import { describe, it, expect } from "vitest";
import { validateDeployConfig } from "../../scripts/deploy-check";

describe("validateDeployConfig", () => {
  const full = {
    DATABASE_URL: "postgresql://user:pw@host:6543/postgres",
    ANTHROPIC_API_KEY: "sk-x",
    BOT_NAME: "Testi",
    BOT_TIER: "pro",
    DASHBOARD_PASSWORD: "pw",
    TELEGRAM_BOT_TOKEN: "tok",
  };

  it("passes with a complete Pro config", () => {
    expect(validateDeployConfig(full)).toEqual({ ok: true, errors: [] });
  });

  it("fails when DATABASE_URL is missing", () => {
    // Sin base no hay bot: es el fallo más común de quien instala, y descubrirlo
    // al primer mensaje del primer cliente sería mucho peor que aquí.
    const { DATABASE_URL, ...rest } = full;
    const r = validateDeployConfig(rest);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("DATABASE_URL");
  });

  it("passes a Free config without DASHBOARD_PASSWORD", () => {
    const { DASHBOARD_PASSWORD, ...rest } = full;
    expect(validateDeployConfig({ ...rest, BOT_TIER: "free" }).ok).toBe(true);
  });

  it("fails when there is no AI key at all", () => {
    const { ANTHROPIC_API_KEY, ...rest } = full;
    const r = validateDeployConfig(rest);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("llave de IA");
  });

  it("passes with OpenAI instead of Anthropic", () => {
    // Exigir Anthropic dejaba fuera a quien instala con OpenAI — que además es
    // el único que cubre de una vez cerebro, embeddings y transcripción fuera
    // de Cloudflare.
    const { ANTHROPIC_API_KEY, ...rest } = full;
    expect(validateDeployConfig({ ...rest, OPENAI_API_KEY: "sk-x" }).ok).toBe(true);
  });

  it("passes with xAI instead of Anthropic", () => {
    const { ANTHROPIC_API_KEY, ...rest } = full;
    expect(validateDeployConfig({ ...rest, XAI_API_KEY: "xai-x" }).ok).toBe(true);
  });

  it("fails when no channel is configured", () => {
    const { TELEGRAM_BOT_TOKEN, ...rest } = full;
    const r = validateDeployConfig(rest);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("canal");
  });

  it("fails Pro without DASHBOARD_PASSWORD", () => {
    const { DASHBOARD_PASSWORD, ...rest } = full;
    const r = validateDeployConfig(rest);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("DASHBOARD_PASSWORD");
  });
});
