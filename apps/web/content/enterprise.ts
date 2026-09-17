// Precios y reglas del tier Enterprise. ÚNICO lugar donde viven los números:
// la tarjeta de #precios, la página /enterprise, la calculadora y el servidor
// (/api/demo recalcula la estimación con esto, no con lo que mande el
// navegador) leen de aquí. La tarjeta del panel (apps/bot, /admin/plan)
// repite el "desde" como texto porque son dos apps sin paquete compartido.
//
// Por qué se cobra por conversaciones y no por usuarios como Vinqulia: Nodia
// ya vende "usuarios ilimitados, por organización" en todos los planes. El
// costo real de un Enterprise es soporte con SLA e implementación; la IA de
// chat va con la llave del cliente y la voz cuesta ≈ $1.75 MXN/min, por eso
// los minutos incluidos van medidos y el excedente se cobra aparte.

export type Modalidad = "nube" | "servidores";

export interface Banda {
  id: "E1" | "E2" | "E3";
  /** Tope de conversaciones al mes que cubre la banda. */
  hastaConversaciones: number;
  /** Minutos de voz al mes incluidos en la licencia. */
  minutosIncluidos: number;
  /** Licencia anual, MXN sin IVA, por modalidad. */
  precio: Record<Modalidad, number>;
}

export const BANDAS: readonly Banda[] = [
  { id: "E1", hastaConversaciones: 10_000, minutosIncluidos: 500, precio: { nube: 189_000, servidores: 249_000 } },
  { id: "E2", hastaConversaciones: 25_000, minutosIncluidos: 1_500, precio: { nube: 289_000, servidores: 349_000 } },
  { id: "E3", hastaConversaciones: 50_000, minutosIncluidos: 3_000, precio: { nube: 429_000, servidores: 499_000 } },
];

/** Arriba de la última banda se cotiza a la medida. */
export const TOPE_COTIZABLE = BANDAS[BANDAS.length - 1].hastaConversaciones;

/** Implementación, una sola vez, MXN sin IVA. */
export const IMPLEMENTACION: Record<Modalidad, number> = { nube: 35_000, servidores: 65_000 };

/** Excedentes sobre lo incluido en la banda, MXN. */
export const EXCEDENTES = { conversacion: 1.9, minutoVoz: 2.6 } as const;

/** Lo que queda fuera de la licencia (conectores a medida, migraciones). */
export const TARIFA_HORA = 1_500;

export const DESCUENTOS = {
  dosAnios: 0.1,
  tresAnios: 0.15,
  fundador: 0.2,
  fundadorCupo: 3,
} as const;

export const PILOTO = { dias: 30, conversaciones: 2_000, precio: 15_000 } as const;

export const DESDE: Record<Modalidad, number> = {
  nube: BANDAS[0].precio.nube,
  servidores: BANDAS[0].precio.servidores,
};

export const MODALIDAD_LABEL: Record<Modalidad, string> = {
  nube: "Nube dedicada",
  servidores: "En tus servidores",
};

export const LIMITES_CALCULADORA = {
  conversaciones: { min: 1_000, max: 100_000, paso: 1_000, inicial: 15_000 },
  minutos: { min: 0, max: 10_000, paso: 100, inicial: 1_000 },
} as const;

export interface Estimacion {
  modalidad: Modalidad;
  conversaciones: number;
  minutos: number;
  banda: Banda;
  licencia: number;
  implementacion: number;
  /** Minutos al mes por encima de los incluidos. */
  minutosExtra: number;
  /** Costo anual estimado de esos minutos extra. */
  vozExtraAnual: number;
  primerAnio: number;
  desdeSegundoAnio: number;
  mensualDesdeSegundoAnio: number;
  /** Solo la licencia entre las conversaciones del año — sin voz ni implementación. */
  porConversacion: number;
}

export type ResultadoEstimacion = { ok: true; estimacion: Estimacion } | { ok: false; motivo: "cotizacion" };

export function bandaPara(conversaciones: number): Banda | null {
  return BANDAS.find((b) => conversaciones <= b.hastaConversaciones) ?? null;
}

export function estimar(input: { modalidad: Modalidad; conversaciones: number; minutos: number }): ResultadoEstimacion {
  const banda = bandaPara(input.conversaciones);
  if (!banda) return { ok: false, motivo: "cotizacion" };
  const licencia = banda.precio[input.modalidad];
  const implementacion = IMPLEMENTACION[input.modalidad];
  const minutosExtra = Math.max(0, input.minutos - banda.minutosIncluidos);
  const vozExtraAnual = Math.round(minutosExtra * EXCEDENTES.minutoVoz * 12);
  const desdeSegundoAnio = licencia + vozExtraAnual;
  return {
    ok: true,
    estimacion: {
      modalidad: input.modalidad,
      conversaciones: input.conversaciones,
      minutos: input.minutos,
      banda,
      licencia,
      implementacion,
      minutosExtra,
      vozExtraAnual,
      primerAnio: desdeSegundoAnio + implementacion,
      desdeSegundoAnio,
      mensualDesdeSegundoAnio: Math.round(desdeSegundoAnio / 12),
      porConversacion: licencia / 12 / input.conversaciones,
    },
  };
}

const fmt = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function mxn(n: number): string {
  return `$${fmt.format(n)}`;
}

export function mxn2(n: number): string {
  return `$${fmt2.format(n)}`;
}

export function num(n: number): string {
  return fmt.format(n);
}
