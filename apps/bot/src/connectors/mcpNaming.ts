/**
 * Cómo se llaman, ante el modelo, las herramientas que vienen de un servidor
 * MCP conectado.
 *
 * Antes el prefijo era el `provider` crudo — `mcp_mcp-e67a790b-85cd-..._query`.
 * Un UUID en medio del nombre no le dice NADA al modelo: gasta tokens, no
 * aporta señal, y si el dueño conecta dos CRMs que ambos exponen una tool
 * `query`, los nombres solo difieren en el UUID — el modelo literalmente no
 * puede distinguir cuál es cuál. Ahora el prefijo sale del nombre que el
 * dueño le puso al conector ("Vinqulia" → `vinqulia_query`).
 *
 * Vive aparte de tools/mcpTools.ts porque settings-loader.ts necesita los
 * mismos prefijos para nombrarlos en el prompt (<herramientas_mcp>), y no
 * tiene por qué arrastrar el cliente MCP entero solo para eso.
 */

/** Tope por segmento: nombres de tool demasiado largos pegan con el límite de 64 de los proveedores. */
const MAX_SLUG = 24;
const MAX_TOOL_NAME = 64;

/** Marcas diacríticas combinantes — lo que deja `normalize("NFD")` al separar "ó" en "o" + acento. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/** "Vinqulia CRM" → "vinqulia_crm". Sin acentos, sin espacios, solo [a-z0-9_]. */
export function mcpConnectorSlug(name: string | null | undefined): string {
  const slug = (name ?? "")
    .normalize("NFD")
    .replace(COMBINING_MARKS, "") // "Añón" → "Anon"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/_+$/, "");
  return slug || "mcp";
}

/**
 * Un prefijo ÚNICO por conector, en el orden que vengan. Dos conectores que
 * se llamen igual ("Vinqulia" y "Vinqulia") no pueden compartir prefijo — el
 * segundo pasa a ser `vinqulia_2`, si no se pisarían las tools entre ellos.
 */
export function mcpToolPrefixes<T extends { provider: string; name?: string | null }>(
  connectors: readonly T[],
): Map<string, string> {
  const used = new Set<string>();
  const byProvider = new Map<string, string>();
  for (const c of connectors) {
    const base = mcpConnectorSlug(c.name);
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}_${n}`;
    used.add(slug);
    byProvider.set(c.provider, slug);
  }
  return byProvider;
}

/** `vinqulia` + `crear_lead` → `vinqulia_crear_lead`, saneado para que el proveedor lo acepte. */
export function mcpToolName(prefix: string, toolName: string): string {
  const safeTool = toolName.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return `${prefix}_${safeTool || "tool"}`.slice(0, MAX_TOOL_NAME);
}
