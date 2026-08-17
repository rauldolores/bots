import { describe, it, expect } from "vitest";
import { toPositional, countPlaceholders } from "../../src/db/placeholders";

describe("toPositional", () => {
  it("numbers placeholders in order", () => {
    expect(toPositional("SELECT * FROM leads WHERE id = ? AND status = ?")).toBe(
      "SELECT * FROM leads WHERE id = $1 AND status = $2",
    );
  });

  it("leaves SQL without placeholders untouched", () => {
    const sql = "SELECT COUNT(*) AS n FROM messages";
    expect(toPositional(sql)).toBe(sql);
  });

  // El caso que motivó escribir un escáner en vez de un replace: este repo
  // habla español y sus literales llevan signos de interrogación.
  it("does not touch a `?` inside a string literal", () => {
    const sql = "INSERT INTO messages (content) VALUES ('¿Confirmas tu cita?')";
    expect(toPositional(sql)).toBe(sql);
  });

  it("mixes literals with real placeholders", () => {
    expect(
      toPositional("UPDATE conv SET last = '¿algo?' WHERE id = ? AND ch = ?"),
    ).toBe("UPDATE conv SET last = '¿algo?' WHERE id = $1 AND ch = $2");
  });

  it("handles the '' escape inside a literal", () => {
    const sql = "SELECT ? WHERE note = 'no s''e si viene?' AND id = ?";
    expect(toPositional(sql)).toBe(
      "SELECT $1 WHERE note = 'no s''e si viene?' AND id = $2",
    );
  });

  it("does not touch a `?` inside a quoted identifier", () => {
    const sql = 'SELECT "raro?" FROM t WHERE id = ?';
    expect(toPositional(sql)).toBe('SELECT "raro?" FROM t WHERE id = $1');
  });

  it("does not touch a `?` inside a line comment", () => {
    const sql = "SELECT id -- ¿por qué?\nFROM leads WHERE id = ?";
    expect(toPositional(sql)).toBe("SELECT id -- ¿por qué?\nFROM leads WHERE id = $1");
  });

  it("does not touch a `?` inside a block comment", () => {
    const sql = "SELECT /* ojo: ? no cuenta */ id FROM leads WHERE id = ?";
    expect(toPositional(sql)).toBe(
      "SELECT /* ojo: ? no cuenta */ id FROM leads WHERE id = $1",
    );
  });

  it("does not touch a `?` inside a dollar-quoted string", () => {
    const sql = "SELECT $$texto con ? adentro$$, ? FROM t";
    expect(toPositional(sql)).toBe("SELECT $$texto con ? adentro$$, $1 FROM t");
  });

  it("collapses `??` to a literal jsonb operator", () => {
    expect(toPositional("SELECT * FROM t WHERE meta ?? ?")).toBe(
      "SELECT * FROM t WHERE meta ? $1",
    );
  });

  it("keeps counting correctly after a literal", () => {
    expect(
      toPositional("SELECT ?, '?', ?, '?', ?"),
    ).toBe("SELECT $1, '?', $2, '?', $3");
  });
});

describe("countPlaceholders", () => {
  it("counts only real placeholders", () => {
    expect(countPlaceholders("SELECT ? WHERE x = '¿?' AND y = ?")).toBe(2);
  });

  it("is zero when there are none", () => {
    expect(countPlaceholders("SELECT 1")).toBe(0);
  });

  it("ignores a `$1` that lives inside a literal", () => {
    expect(countPlaceholders("SELECT '$1', ?")).toBe(1);
  });
});
