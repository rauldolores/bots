// D1 (SQLite) usa `?` posicional; Postgres usa `$1..$n`. En vez de reescribir el
// SQL de los 31 archivos que hablan con la base, traducimos aquí — es el sello
// que ya existía en `Db` (ver docs/portabilidad.md, decisión D5).
//
// El detalle que hace esto delicado: NO todo `?` es un placeholder. Este repo
// habla español, y `'¿Confirmas?'` dentro de un literal es texto, no parámetro.
// Tampoco lo son los `?` dentro de comentarios ni los operadores jsonb de
// Postgres (`?`, `?|`, `?&`). Por eso escaneamos en vez de hacer replace.

/** Estructuras dentro de las cuales un `?` es texto, no placeholder. */
type Scan =
  | { kind: "sql" }
  | { kind: "line-comment" }
  | { kind: "block-comment" }
  | { kind: "quote"; close: string } // literal '...' o identificador "..."
  | { kind: "dollar"; tag: string }; // $$...$$ / $tag$...$tag$

/**
 * Traduce los `?` posicionales a `$1..$n`, respetando literales, identificadores
 * entrecomillados, comentarios y cadenas con dólar.
 *
 * Los operadores jsonb de Postgres (`?`, `?|`, `?&`) se escriben `??`, `??|` y
 * `??&` — igual que en otros drivers — y aquí se colapsan a un solo `?` literal.
 */
export function toPositional(sql: string): string {
  return translate(sql).text;
}

/** Cuenta cuántos placeholders `?` reales tiene la consulta. */
export function countPlaceholders(sql: string): number {
  return translate(sql).count;
}

function translate(sql: string): { text: string; count: number } {
  let out = "";
  let n = 0;
  let state: Scan = { kind: "sql" };

  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const next = sql[i + 1];

    switch (state.kind) {
      case "line-comment":
        out += c;
        if (c === "\n") state = { kind: "sql" };
        continue;

      case "block-comment":
        out += c;
        if (c === "*" && next === "/") {
          out += next;
          i++;
          state = { kind: "sql" };
        }
        continue;

      case "quote":
        out += c;
        // '' y "" son la comilla escapada: siguen dentro del literal.
        if (c === state.close) {
          if (next === state.close) {
            out += next;
            i++;
          } else {
            state = { kind: "sql" };
          }
        }
        continue;

      case "dollar": {
        if (c === "$" && sql.startsWith(state.tag, i)) {
          out += state.tag;
          i += state.tag.length - 1;
          state = { kind: "sql" };
          continue;
        }
        out += c;
        continue;
      }

      case "sql":
        break;
    }

    // ── Estamos en SQL de verdad ──────────────────────────────────────────
    if (c === "-" && next === "-") {
      out += "--";
      i++;
      state = { kind: "line-comment" };
      continue;
    }
    if (c === "/" && next === "*") {
      out += "/*";
      i++;
      state = { kind: "block-comment" };
      continue;
    }
    if (c === "'" || c === '"') {
      out += c;
      state = { kind: "quote", close: c };
      continue;
    }
    if (c === "$") {
      const tag = matchDollarTag(sql, i);
      if (tag) {
        out += tag;
        i += tag.length - 1;
        state = { kind: "dollar", tag };
        continue;
      }
      out += c;
      continue;
    }
    if (c === "?") {
      // `??`, `??|`, `??&` → operador jsonb literal, no placeholder.
      if (next === "?") {
        out += "?";
        i++;
        continue;
      }
      out += "$" + ++n;
      continue;
    }

    out += c;
  }

  return { text: out, count: n };
}

/** Devuelve la etiqueta `$$` / `$tag$` que abre en `i`, o null si no es una. */
function matchDollarTag(sql: string, i: number): string | null {
  const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
  return m ? m[0] : null;
}
