import { describe, expect, it } from "vitest";
import { WIDGET_DEFAULTS, toPublicWidgetConfig, widgetConfigFromForm } from "../../src/widget/config";

// Puras, sin base de datos: la definición única de qué campos existen, sus
// defaults y su saneado — lo que comparten /widget/config y /admin/conexiones.

describe("toPublicWidgetConfig", () => {
  it("un widget conectado antes de que existieran los campos nuevos se ve igual que antes", () => {
    const cfg = toPublicWidgetConfig({ bubbleColor: "#F5C518", position: "bottom-left", greeting: "hola" }, "Mi Negocio");
    expect(cfg).toEqual({ ...WIDGET_DEFAULTS, businessName: "Mi Negocio", bubbleColor: "#F5C518", position: "bottom-left", greeting: "hola" });
  });

  it("sanea valores inválidos en vez de mandarlos al navegador", () => {
    const cfg = toPublicWidgetConfig(
      {
        bubbleColor: "red",
        position: "top-left" as never,
        avatarUrl: "javascript:alert(1)",
        launcherIcon: "rocket" as never,
        theme: "blue" as never,
        radius: 900,
        offsetX: -5,
        openDelaySec: "x" as never,
        title: "  Título  ",
      },
      "",
    );
    expect(cfg.businessName).toBe("Chat");
    expect(cfg.bubbleColor).toBe(WIDGET_DEFAULTS.bubbleColor);
    expect(cfg.position).toBe("bottom-right");
    expect(cfg.avatarUrl).toBe("");
    expect(cfg.launcherIcon).toBe("chat");
    expect(cfg.theme).toBe("light");
    expect(cfg.radius).toBe(32);
    expect(cfg.offsetX).toBe(0);
    expect(cfg.openDelaySec).toBe(WIDGET_DEFAULTS.openDelaySec);
    expect(cfg.title).toBe("Título");
  });

  it("acepta https y http en el avatar, nada más", () => {
    expect(toPublicWidgetConfig({ avatarUrl: "https://x.test/a.png" }, "N").avatarUrl).toBe("https://x.test/a.png");
    expect(toPublicWidgetConfig({ avatarUrl: "data:image/png;base64,AAAA" }, "N").avatarUrl).toBe("");
  });
});

describe("widgetConfigFromForm", () => {
  function form(entries: Record<string, string>): FormData {
    const f = new FormData();
    for (const [k, v] of Object.entries(entries)) f.set(k, v);
    return f;
  }

  it("un color inválido conserva el anterior; checkboxes ausentes son false", () => {
    const out = widgetConfigFromForm(form({ bubble_color: "nope", position: "bottom-left" }), { bubbleColor: "#123456" });
    expect(out.bubbleColor).toBe("#123456");
    expect(out.position).toBe("bottom-left");
    expect(out.showPoweredBy).toBe(false);
    expect(out.hideOnMobile).toBe(false);
  });

  it("recorta números al rango permitido y redondea", () => {
    const out = widgetConfigFromForm(form({ radius: "12.6", offset_x: "-3", offset_y: "1000", open_delay_sec: "7" }), {});
    expect(out.radius).toBe(13);
    expect(out.offsetX).toBe(0);
    expect(out.offsetY).toBe(200);
    expect(out.openDelaySec).toBe(7);
  });
});
