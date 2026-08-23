import { describe, it, expect } from "vitest";
import { WIDGET_SCRIPT_JS } from "../../src/widget/script";

describe("WIDGET_SCRIPT_JS", () => {
  it("es JavaScript sintácticamente válido", () => {
    expect(() => new Function(WIDGET_SCRIPT_JS)).not.toThrow();
  });

  it("no usa backticks ni template literals en su propio cuerpo", () => {
    expect(WIDGET_SCRIPT_JS).not.toContain("`");
  });
});
