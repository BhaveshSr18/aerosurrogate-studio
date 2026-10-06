/**
 * Canonical site URL for metadata, the sitemap and share previews. Set NEXT_PUBLIC_SITE_URL for
 * a custom domain; on Vercel the production domain is provided automatically at build time.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")
).replace(/\/$/, "");

export const SITE_NAME = "AeroSurrogate Studio";
export const SITE_DESCRIPTION =
  "Airfoil design and optimization with a MeshGraphNet CFD surrogate trained on the AirfRANS RANS dataset: full flow fields, polars and optimization in the browser.";

export const ROUTES = ["/", "/studio", "/polar", "/optimize", "/compare", "/model"] as const;
