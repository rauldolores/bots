/**
 * Quién escribe un correo, y si hay que contestarle.
 *
 * Existe por un correo del 2026-09-24: alguien escribió "ayuda", el bot abrió
 * dos tickets a nombre de nadie. El nombre se saca primero del sobre ("Laura
 * Pérez <laura@…>") y, si no, de la firma — eso último lo hace el filtro de
 * intención en la misma llamada con la que decide si el correo es de un
 * cliente.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { nombreDeDireccion, nombreDelRemitente } from "../../../src/channels/email/reenvio";

const generateObjectMock = vi.fn();
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateObject: (...a: unknown[]) => generateObjectMock(...a) };
});

import { createTestDb, TEST_BOT_ID } from "../../helpers/pgSetup";
import { SettingsRepo, SETTING_KEYS } from "../../../src/db/settings";
import { clasificarCorreo, CONFIANZA_MINIMA_PARA_FILTRAR } from "../../../src/channels/email/triage";
import type { Db } from "../../../src/db/client";

describe("nombreDeDireccion", () => {
  it("saca el nombre del sobre, con o sin comillas", () => {
    expect(nombreDeDireccion("Laura Pérez <laura@acme.com>")).toBe("Laura Pérez");
    expect(nombreDeDireccion('"Pérez, Laura" <laura@acme.com>')).toBe("Pérez, Laura");
  });
  it("sin nombre, o con un 'nombre' que es la dirección misma: vacío", () => {
    expect(nombreDeDireccion("laura@acme.com")).toBe("");
    expect(nombreDeDireccion("<laura@acme.com>")).toBe("");
    expect(nombreDeDireccion('"laura@acme.com" <laura@acme.com>')).toBe("");
    expect(nombreDeDireccion(null)).toBe("");
  });
});

describe("nombreDelRemitente", () => {
  it("el From cuando es la persona real", () => {
    expect(nombreDelRemitente({ from: "Laura Pérez <laura@acme.com>" }, "laura@acme.com")).toBe("Laura Pérez");
  });
  it("en un reenvío NO toma el nombre del buzón del negocio: busca la línea De: del cliente", () => {
    const text = "---------- Forwarded message ---------\nDe: Laura Pérez <laura@acme.com>\nAsunto: Ayuda\n\nNo me llega la factura";
    expect(nombreDelRemitente({ from: "Soporte Kontrolia <hola@kontrolia.com>", text }, "laura@acme.com")).toBe("Laura Pérez");
  });
  it("sin nombre en ningún lado: null (lo resolverá la firma o se le pregunta)", () => {
    expect(nombreDelRemitente({ from: "laura@acme.com" }, "laura@acme.com")).toBeNull();
  });
});

describe("clasificarCorreo", () => {
  let db: Db;
  const env = () => ({ DB: db.driver, ANTHROPIC_API_KEY: "sk-test", BUSINESS_NAME: "Acme" }) as any;
  const correo = { de: "x@y.com", asunto: "Hola", cuerpo: "texto" };
  const respuesta = (o: Record<string, unknown>) => ({
    object: { categoria: "cliente", confianza: 0.9, motivo: "Pregunta por un pedido", nombre: null, empresa: null, telefono: null, ...o },
    usage: { inputTokens: 300, outputTokens: 40 },
  });

  beforeEach(async () => {
    db = await createTestDb();
    generateObjectMock.mockReset();
  });

  it("un vendedor con confianza alta se aparta, y el costo queda registrado como 'filtro'", async () => {
    generateObjectMock.mockResolvedValue(respuesta({ categoria: "vendedor", confianza: 0.95, motivo: "Agencia de SEO" }));
    const t = await clasificarCorreo(env(), TEST_BOT_ID, correo);
    expect(t).toMatchObject({ atender: false, categoria: "vendedor", clasificado: true });
    const [uso] = await db.all<{ source: string }>("SELECT source FROM ai_usage");
    expect(uso.source).toBe("filtro");
  });

  it("ante la duda se atiende: una categoría que no es cliente pero con poca confianza", async () => {
    generateObjectMock.mockResolvedValue(respuesta({ categoria: "publicidad", confianza: CONFIANZA_MINIMA_PARA_FILTRAR - 0.1 }));
    expect((await clasificarCorreo(env(), TEST_BOT_ID, correo)).atender).toBe(true);
  });

  it("falla ABIERTO: si el modelo truena, se atiende", async () => {
    generateObjectMock.mockRejectedValue(new Error("529 overloaded"));
    expect(await clasificarCorreo(env(), TEST_BOT_ID, correo)).toMatchObject({ atender: true, clasificado: false });
  });

  it("apagado desde el panel: ni siquiera llama al modelo", async () => {
    await new SettingsRepo(db, TEST_BOT_ID).set(SETTING_KEYS.emailFiltroIntencion, "0");
    expect((await clasificarCorreo(env(), TEST_BOT_ID, correo)).atender).toBe(true);
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it("de la firma: nombre, empresa y teléfono — descartando lo que no puede ser", async () => {
    generateObjectMock.mockResolvedValue(respuesta({ nombre: "Laura Pérez", empresa: "Acme", telefono: "+52 55 1234 5678" }));
    expect(await clasificarCorreo(env(), TEST_BOT_ID, correo)).toMatchObject({
      nombre: "Laura Pérez",
      empresa: "Acme",
      telefono: "+52 55 1234 5678",
    });
    generateObjectMock.mockResolvedValue(respuesta({ nombre: "laura@acme.com", telefono: "123" }));
    expect(await clasificarCorreo(env(), TEST_BOT_ID, correo)).toMatchObject({ nombre: null, telefono: null });
  });
});
