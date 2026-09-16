// Registro de industrias: el ÚNICO lugar donde se agrega una industria nueva.
//
// Para publicar una página nueva: crea `content/industrias/<slug>.ts` con un
// objeto `Industry`, impórtalo aquí y agrégalo al arreglo. La ruta
// /industrias/[slug], el sitemap, el menú desplegable, el hub y los enlaces
// internos se generan solos a partir de este registro.
import type { Industry } from "./types";
import { restaurantes } from "./restaurantes";
import { clinicasYConsultorios } from "./clinicas-y-consultorios";
import { talleresMecanicos } from "./talleres-mecanicos";
import { barberiasYSalon } from "./barberias-y-salon";
import { veterinarias } from "./veterinarias";
import { inmobiliarias } from "./inmobiliarias";
import { hotelesYHospedaje } from "./hoteles-y-hospedaje";
import { serviciosProfesionales } from "./servicios-profesionales";
import { escuelasYAcademias } from "./escuelas-y-academias";
import { gimnasiosYEstudios } from "./gimnasios-y-estudios";

export type { Industry } from "./types";

/** Todas las industrias publicadas, ordenadas por prioridad comercial. */
export const industries: Industry[] = [
  restaurantes,
  clinicasYConsultorios,
  talleresMecanicos,
  barberiasYSalon,
  veterinarias,
  inmobiliarias,
  hotelesYHospedaje,
  serviciosProfesionales,
  escuelasYAcademias,
  gimnasiosYEstudios,
].sort((a, b) => a.priority - b.priority);

export function getIndustry(slug: string): Industry | undefined {
  return industries.find((i) => i.slug === slug);
}

export function allIndustrySlugs(): string[] {
  return industries.map((i) => i.slug);
}

/**
 * Industrias relacionadas para el enlazado interno. Filtra slugs que no
 * existen (así una industria puede declarar relaciones con páginas que aún no
 * se publican sin romper enlaces) y nunca devuelve la propia.
 */
export function relatedIndustries(industry: Industry): Industry[] {
  return industry.related
    .filter((slug) => slug !== industry.slug)
    .map((slug) => getIndustry(slug))
    .filter((i): i is Industry => Boolean(i))
    .slice(0, 3);
}

/** Datos mínimos para el menú de navegación (no manda el contenido completo al cliente). */
export function industryNavItems() {
  return industries.map((i) => ({
    slug: i.slug,
    shortName: i.shortName,
    tagline: i.tagline,
    icon: i.icon,
  }));
}
