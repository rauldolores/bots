/**
 * A quién le toca ElevenLabs y a quién no.
 *
 * La prueba corre en el MISMO número de teléfono que producción: no hay un
 * segundo número donde aislarla. Así que esta función es lo único que separa
 * "el dueño probando" de "un cliente real llamando", y por eso se prueba con
 * más cuidado que el resto del experimento.
 *
 * Sin base de datos a propósito: es una decisión pura sobre un string.
 */
import { describe, it, expect } from "vitest";
import { elegirProveedorDeVoz } from "../../src/channels/voice/callBridge";

const env = (lista?: string) => ({ VOICE_ELEVENLABS_BETA_CALLERS: lista }) as any;

describe("a quién atiende ElevenLabs", () => {
  it("sin lista configurada, TODO sigue por OpenAI", () => {
    // El default tiene que ser el de producción: un despliegue que no sabe del
    // experimento no puede caer en él por accidente.
    expect(elegirProveedorDeVoz(env(), "+5215512345678")).toBe("openai");
    expect(elegirProveedorDeVoz(env(""), "+5215512345678")).toBe("openai");
    expect(elegirProveedorDeVoz(env("   "), "+5215512345678")).toBe("openai");
  });

  it("el teléfono de la lista sí va a ElevenLabs", () => {
    expect(elegirProveedorDeVoz(env("+5215512345678"), "+5215512345678")).toBe("elevenlabs");
  });

  it("cualquier OTRO teléfono se queda en OpenAI", () => {
    // Lo que protege a los clientes reales durante la prueba.
    expect(elegirProveedorDeVoz(env("+5215512345678"), "+5219998887766")).toBe("openai");
  });

  it("acepta varios teléfonos separados por comas, con espacios", () => {
    const lista = env(" +5215512345678 , 5219998887766 ");
    expect(elegirProveedorDeVoz(lista, "+5215512345678")).toBe("elevenlabs");
    expect(elegirProveedorDeVoz(lista, "+5219998887766")).toBe("elevenlabs");
    expect(elegirProveedorDeVoz(lista, "+5211112223344")).toBe("openai");
  });

  it("el mismo teléfono escrito de otra forma sigue siendo el mismo", () => {
    // Twilio entrega "+5215512345678"; el dueño escribe lo que se sabe de
    // memoria. Comparar textos exactos haría que la prueba "no funcione" por
    // un espacio o un lada, y eso se diagnostica pésimo desde una llamada.
    const lista = env("55 1234 5678");
    expect(elegirProveedorDeVoz(lista, "+5215512345678")).toBe("elevenlabs");
    expect(elegirProveedorDeVoz(lista, "5512345678")).toBe("elevenlabs");
    expect(elegirProveedorDeVoz(lista, "(55) 1234-5678")).toBe("elevenlabs");
  });

  it("un número parecido pero distinto NO entra", () => {
    expect(elegirProveedorDeVoz(env("5512345678"), "+5215512345679")).toBe("openai");
  });

  it("sin identificador de quien llama (número oculto), se queda en OpenAI", () => {
    // Ante la duda, producción. Un número oculto nunca es el dueño probando.
    expect(elegirProveedorDeVoz(env("5512345678"), "")).toBe("openai");
    expect(elegirProveedorDeVoz(env("5512345678"), "anonymous")).toBe("openai");
  });
});
