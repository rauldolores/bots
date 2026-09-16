// Modelo de contenido de las páginas por industria (/industrias/<slug>).
//
// Un solo objeto `Industry` describe TODA la página. Las secciones son
// opcionales salvo las del núcleo narrativo, para que una industria con menos
// material no obligue a rellenar bloques vacíos (y para que agregar una
// industria nueva sea escribir un archivo de datos, nunca tocar componentes).

export type IndustryIcon =
  | "utensils"
  | "stethoscope"
  | "scissors"
  | "building"
  | "car"
  | "paw"
  | "dumbbell"
  | "bed"
  | "graduation"
  | "briefcase";

/** Canal por el que ocurre un momento del día o un caso de uso. */
export type Channel = "chat" | "voz" | "ambos";

export interface Cta {
  label: string;
  href: string;
}

export interface IndustrySeo {
  /** Title de la página (sin el sufijo de marca: lo agrega el layout). */
  title: string;
  description: string;
  keywords: string[];
  /** Keyword principal a la que apunta la página — se usa para evitar canibalización. */
  primaryKeyword: string;
  secondaryKeywords: string[];
  longTailKeywords: string[];
  /** Preguntas que busca la gente y que la página responde (guía del copy y del FAQ). */
  searchQuestions: string[];
  intent: "comercial" | "informativa" | "transaccional" | "mixta";
  /** Términos que NO debe atacar esta página porque pertenecen a otra (anti-canibalización). */
  avoidTerms?: string[];
}

export interface IndustryHero {
  eyebrow: string;
  /** Primera parte del H1, en texto normal. */
  title: string;
  /** Parte del H1 resaltada con el degradado de marca. */
  titleHighlight: string;
  subtitle: string;
  primaryCta: Cta;
  secondaryCta?: Cta;
  /** Afirmaciones cortas de apoyo (se muestran como chips bajo el CTA). */
  proofPoints: string[];
}

export interface Pain {
  title: string;
  desc: string;
}

export interface IndustryProblem {
  title: string;
  intro: string;
  pains: Pain[];
  /** Cierre honesto: qué NO es el problema (evita prometer de más). */
  note?: string;
}

export interface DayMoment {
  /** Etiqueta de tiempo: "8:00 am", "Mediodía", "Cierre". */
  time: string;
  title: string;
  /** Qué pasa hoy en la operación, sin hablar del producto. */
  situation: string;
  /** Qué hace el agente en ese momento (funcionalidad real). */
  agent: string;
  channel: Channel;
}

export interface IndustryDayInLife {
  title: string;
  intro: string;
  moments: DayMoment[];
}

export interface SolutionRow {
  problem: string;
  solution: string;
  benefit: string;
}

export interface IndustryProblemSolution {
  title: string;
  intro?: string;
  rows: SolutionRow[];
}

export interface UseCase {
  icon: string;
  title: string;
  desc: string;
  channel: Channel;
}

export interface IndustryUseCases {
  title: string;
  intro?: string;
  items: UseCase[];
}

export interface CaseStudyResult {
  label: string;
  value: string;
}

export interface CaseStudy {
  /** Escenario: "Restaurante con 2 sucursales, 6 personas y 400 conversaciones al mes". */
  scenario: string;
  /** Contexto de la operación antes de nada. */
  context: string[];
  initial: string[];
  withProduct: string[];
  results: CaseStudyResult[];
  /** Aclaración obligatoria: los números son una simulación, no un caso real auditado. */
  disclaimer: string;
}

export interface IndustryWhoFor {
  title: string;
  intro: string;
  forWho: string[];
  notForWho: string[];
  notForNote: string;
}

export interface Benefit {
  /** Funcionalidad real del producto. */
  functionality: string;
  /** Qué cambia en el día a día. */
  benefit: string;
  /** Resultado empresarial. */
  result: string;
  icon: string;
}

export interface IndustryBenefits {
  title: string;
  intro?: string;
  items: Benefit[];
}

export interface ComparisonRow {
  aspect: string;
  traditional: string;
  withNodia: string;
}

export interface IndustryComparison {
  title: string;
  intro?: string;
  rows: ComparisonRow[];
}

export interface Objection {
  q: string;
  a: string;
}

export interface IndustryObjections {
  title: string;
  intro?: string;
  items: Objection[];
}

export interface FaqItem {
  q: string;
  a: string;
}

export interface IndustryFaq {
  title: string;
  intro?: string;
  items: FaqItem[];
}

/**
 * Funcionalidad que la industria pediría y que HOY no existe. Se muestra en su
 * propia sección, marcada como pendiente — nunca como algo disponible.
 */
export interface FutureOpportunity {
  title: string;
  desc: string;
}

export interface IndustryFutureOpportunities {
  title: string;
  intro: string;
  items: FutureOpportunity[];
}

export interface IndustryCta {
  title: string;
  subtitle: string;
  primary: Cta;
  secondary?: Cta;
  bullets: string[];
}

export interface Industry {
  slug: string;
  /** Nombre en plural, como se titula la página: "Restaurantes y cafeterías". */
  name: string;
  /** Nombre corto para menús y migas: "Restaurantes". */
  shortName: string;
  icon: IndustryIcon;
  /** Una línea que resume el encaje con el producto (se usa en el hub y el dropdown). */
  tagline: string;
  /** Orden en el hub/menú: menor = primero. */
  priority: number;

  seo: IndustrySeo;
  hero: IndustryHero;
  problem: IndustryProblem;
  dayInLife: IndustryDayInLife;
  problemSolution: IndustryProblemSolution;
  useCases: IndustryUseCases;
  caseStudy: CaseStudy;
  whoFor: IndustryWhoFor;
  benefits: IndustryBenefits;
  comparison: IndustryComparison;
  objections: IndustryObjections;
  faq: IndustryFaq;
  futureOpportunities?: IndustryFutureOpportunities;
  cta: IndustryCta;
  /** Slugs de industrias relacionadas (enlaces internos). */
  related: string[];
}
