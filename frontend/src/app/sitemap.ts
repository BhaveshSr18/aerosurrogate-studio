import type { MetadataRoute } from "next";
import { ROUTES, SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTES.map((r) => ({ url: `${SITE_URL}${r === "/" ? "" : r}`, changeFrequency: "weekly", priority: r === "/" ? 1 : 0.7 }));
}
