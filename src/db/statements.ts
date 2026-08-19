// Parte un archivo SQL en sentencias, respetando lo que un `split(";")` ingenuo
// rompe: literales, identificadores entrecomillados, comentarios y —el que nos
// mordió— las cadenas con dólar.
//
// Un bloque `DO $$ ... $$;` lleva puntos y coma DENTRO. Cortando por `;` a secas
// llega al motor partido a la mitad y falla con un error de sintaxis que no
// dice nada útil. Pasó al escribir la migración multi-tenant.

/** Estructuras dentro de las cuales un `;` NO termina la sentencia. */
type Scan =
  | { kind: "sql" }
  | { kind: "line-comment" }
  | { kind: "block-comment" }
  | { kind: "quote"; close: string }
  | { kind: "dollar"; tag: string };

export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let actual = "";
  let state: Scan = { kind: "sql" };

  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const next = sql[i + 1];

    switch (state.kind) {
      case "line-comment":
        actual += c;
        if (c === "\n") state = { kind: "sql" };
        continue;

      case "block-comment":
        actual += c;
        if (c === "*" && next === "/") {
          actual += next;
          i++;
          state = { kind: "sql" };
        }
        continue;

      case "quote":
        actual += c;
        if (c === state.close) {
          if (next === state.close) {
            actual += next;
            i++;
          } else {
            state = { kind: "sql" };
          }
        }
        continue;

      case "dollar": {
        if (c === "$" && sql.startsWith(state.tag, i)) {
          actual += state.tag;
          i += state.tag.length - 1;
          state = { kind: "sql" };
          continue;
        }
        actual += c;
        continue;
      }

      case "sql":
        break;
    }

    if (c === "-" && next === "-") {
      actual += "--";
      i++;
      state = { kind: "line-comment" };
      continue;
    }
    if (c === "/" && next === "*") {
      actual += "/*";
      i++;
      state = { kind: "block-comment" };
      continue;
    }
    if (c === "'" || c === '"') {
      actual += c;
      state = { kind: "quote", close: c };
      continue;
    }
    if (c === "$") {
      const tag = etiquetaDolar(sql, i);
      if (tag) {
        actual += tag;
        i += tag.length - 1;
        state = { kind: "dollar", tag };
        continue;
      }
      actual += c;
      continue;
    }
    if (c === ";") {
      out.push(actual);
      actual = "";
      continue;
    }

    actual += c;
  }

  out.push(actual);
  return out.map(limpiar).filter((s) => s.length > 0);
}

/** Quita comentarios y espacio sobrante; deja vacío lo que era solo comentario. */
function limpiar(stmt: string): string {
  return stmt
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .trim();
}

/** La etiqueta `$$` o `$tag$` que abre en `i`, o null si no lo es. */
function etiquetaDolar(sql: string, i: number): string | null {
  const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
  return m ? m[0] : null;
}
