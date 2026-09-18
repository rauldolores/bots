import type { MetadataRoute } from "next";
import { industries } from "@/content/industrias";
import { absoluteUrl } from "@/lib/site";

/**
 * Sitemap generado desde el registro de industrias: publicar una industria
 * nueva en `content/industrias/index.ts` la mete aquí automáticamente.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  const home: MetadataRoute.Sitemap = [
    {
      url: absoluteUrl("/"),
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];

  const hub: MetadataRoute.Sitemap = [
    {
      url: absoluteUrl("/industrias"),
      lastModified,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: absoluteUrl("/enterprise"),
      lastModified,
      changeFrequency: "monthly",
      priority: 0.9,
    },
  ];

  const legal: MetadataRoute.Sitemap = ["/privacidad", "/terminos", "/privacidad/usuarios"].map((path) => ({
    url: absoluteUrl(path),
    lastModified,
    changeFrequency: "yearly",
    priority: 0.3,
  }));

  const industryPages: MetadataRoute.Sitemap = industries.map((i) => ({
    url: absoluteUrl(`/industrias/${i.slug}`),
    lastModified,
    changeFrequency: "monthly",
    priority: 0.8,
  }));

  return [...home, ...hub, ...industryPages, ...legal];
}
