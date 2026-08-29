// La pantalla de costos mostraba dólares con un "$" a secas. En México eso se
// lee como pesos, así que un gasto de 12.50 USD parecía costar doce pesos con
// cincuenta en vez de unos doscientos. Estas pruebas cubren de dónde sale el
// tipo de cambio y, sobre todo, que nunca se caiga la pantalla por él.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolverUsdMxn, explicarTipoCambio, USD_MXN_RESPALDO } from "../src/fx";
import { SETTING_KEYS } from "../src/db/settings";
import type { Db } from "../src/db/client";

const BOT = "bot-1";

/** Un Db de mentiras con las settings en memoria. fx.ts no escribe SQL propio
 *  —todo pasa por SettingsRepo—, así que aquí no hay SQL que probar de verdad. */
function fakeDb(inicial: Record<string, string> = {}) {
  const store = { ...inicial };
  const db = {
    async first<T>(_sql: string, params: unknown[]): Promise<T | null> {
      const key = String(params[1]);
      return key in store ? ({ value: store[key] } as T) : null;
    },
    async run(_sql: string, params: unknown[]) {
      store[String(params[1])] = String(params[2]);
      return { changes: 1 } as never;
    },
    async all() {
      return [];
    },
  } as unknown as Db;
  return { db, store };
}

function respuestaBce(mxn: number) {
  return { ok: true, json: async () => ({ amount: 1, base: "USD", rates: { MXN: mxn } }) };
}

describe("tipo de cambio USD → MXN", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("lo que el dueño fijó a mano gana sobre todo lo demás — y sin tocar la red", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { db } = fakeDb({ [SETTING_KEYS.fxUsdMxn]: "19.5" });
    return resolverUsdMxn(db, BOT).then((tc) => {
      expect(tc).toMatchObject({ valor: 19.5, origen: "manual" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it("usa la caché si tiene menos de 24 h, en vez de consultar en cada carga", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { db } = fakeDb({
      [SETTING_KEYS.fxUsdMxnCache]: "17.2",
      [SETTING_KEYS.fxUsdMxnCacheAt]: String(Date.now() - 3 * 60 * 60 * 1000),
    });
    const tc = await resolverUsdMxn(db, BOT);
    expect(tc).toMatchObject({ valor: 17.2, origen: "cache" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("con la caché vencida consulta al BCE y guarda el resultado", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaBce(16.9481)));
    const { db, store } = fakeDb({
      [SETTING_KEYS.fxUsdMxnCache]: "17.2",
      [SETTING_KEYS.fxUsdMxnCacheAt]: String(Date.now() - 48 * 60 * 60 * 1000),
    });
    const tc = await resolverUsdMxn(db, BOT);
    expect(tc).toMatchObject({ valor: 16.9481, origen: "vivo" });
    // Guardado, para que la siguiente visita no vuelva a salir a la red.
    expect(store[SETTING_KEYS.fxUsdMxnCache]).toBe("16.9481");
  });

  it("si la red falla se queda con la caché vieja — un dato de ayer vale más que una constante", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("sin red"); }));
    const { db } = fakeDb({
      [SETTING_KEYS.fxUsdMxnCache]: "18.4",
      [SETTING_KEYS.fxUsdMxnCacheAt]: String(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });
    const tc = await resolverUsdMxn(db, BOT);
    expect(tc).toMatchObject({ valor: 18.4, origen: "cache" });
  });

  it("sin red y sin caché cae al respaldo, en vez de tumbar la pantalla de costos", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("sin red"); }));
    const { db } = fakeDb();
    const tc = await resolverUsdMxn(db, BOT);
    expect(tc).toMatchObject({ valor: USD_MXN_RESPALDO, origen: "respaldo" });
  });

  it("rechaza valores absurdos vengan de donde vengan — un 17000 haría mentir a toda la pantalla", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("sin red"); }));
    for (const basura of ["0", "0.17", "17000", "abc", ""]) {
      const { db } = fakeDb({ [SETTING_KEYS.fxUsdMxn]: basura });
      const tc = await resolverUsdMxn(db, BOT);
      expect(tc.origen).toBe("respaldo");
    }
  });

  it("una respuesta con forma inesperada del BCE no se toma por buena", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ error: "nope" }) })));
    const { db } = fakeDb();
    const tc = await resolverUsdMxn(db, BOT);
    expect(tc).toMatchObject({ origen: "respaldo" });
  });

  it("un HTTP 500 tampoco", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const { db } = fakeDb();
    expect((await resolverUsdMxn(db, BOT)).origen).toBe("respaldo");
  });
});

describe("cómo se le explica al dueño", () => {
  it("dice el valor y de dónde salió, sin tecnicismos", () => {
    expect(explicarTipoCambio({ valor: 17.0512, origen: "vivo", obtenidoEn: Date.now() }))
      .toContain("$17.05 MXN por dólar");
    expect(explicarTipoCambio({ valor: 19.5, origen: "manual" })).toContain("el que tú configuraste");
  });

  it("cuando es el respaldo lo admite, en vez de aparentar precisión", () => {
    const texto = explicarTipoCambio({ valor: USD_MXN_RESPALDO, origen: "respaldo" });
    expect(texto).toContain("aproximado");
    expect(texto).toContain("no se pudo consultar");
  });
});
