// Antes esto probaba el gate de planes: un bot "free" recibía 5 tools y uno
// "pro" 7 (agendar cita y consultar catálogo eran de pago). Ese gate se quitó
// —este producto no tiene planes, ver src/config.ts— así que ahora lo que se
// prueba es lo contrario: que TODOS los bots reciban TODAS las tools, sin que
// nada dependa de bots.tier.
import { describe, it, expect } from "vitest";
import { buildTools, type ToolContext } from "../../src/tools/index";

const TODAS = [
  "captureLead",
  "catalogQuery",
  "handoffHuman",
  "pauseBot",
  "scheduleAppointment",
  "searchKb",
  "snoozeUser",
].sort();

function makeCtx(): ToolContext {
  const env = {
    DB: {} as any,
    AI: {} as any,
    BUSINESS_NAME: "Test",
    OWNER_EMAIL: "owner@test.com",
    DASHBOARD_BASE_URL: "https://example.com",
  } as any;
  return {
    env,
    getConversationId: () => "conv-1",
    botId: "00000000-0000-0000-0000-000000000001",
  };
}

describe("buildTools", () => {
  it("registra TODAS las tools, sin distinción de plan", () => {
    expect(Object.keys(buildTools(makeCtx())).sort()).toEqual(TODAS);
  });

  // Las dos que antes estaban detrás del plan. Se nombran explícitamente para
  // que, si alguien vuelve a meter un gate comercial, esta prueba lo señale.
  it("agendar cita y consultar catálogo ya NO dependen de ningún plan", () => {
    const tools = buildTools(makeCtx());
    expect(tools).toHaveProperty("scheduleAppointment");
    expect(tools).toHaveProperty("catalogQuery");
  });

  it("el contexto de tools ya no acepta un tier", () => {
    // Si alguien reintrodujera `tier` en ToolContext, este objeto dejaría de
    // compilar — la prueba vive tanto en el tipo como en la aserción.
    const ctx = makeCtx();
    expect(ctx).not.toHaveProperty("tier");
  });
});
