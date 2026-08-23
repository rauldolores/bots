/**
 * El contexto de ejecución, si la plataforma lo tiene.
 *
 * Hono LANZA al acceder a `c.executionCtx` cuando no existe (que es el caso en
 * un servidor Node), así que hay que envolverlo. Sin esto, el webhook (o el
 * endpoint del widget) devolvía 500 y el canal lo reintentaba — el cliente
 * terminaba con la respuesta duplicada.
 */
export function ctxOpcional(c: { executionCtx?: unknown }): { waitUntil(p: Promise<unknown>): void } | null {
  try {
    const ctx = c.executionCtx as { waitUntil?: unknown } | undefined;
    return ctx && typeof ctx.waitUntil === "function" ? (ctx as any) : null;
  } catch {
    return null;
  }
}
