import type { Design } from "./types";

const base = { naca5: { L: 2, P: 3, Q: 0 as const, T: 12 }, naca4: { M: 2, P: 4, T: 12 }, aoa: 4, speed: 50 };

export const DEFAULT_DESIGN: Design = { ...base, family: "4" };

export const PRESETS: { name: string; note: string; design: Design }[] = [
  { name: "NACA 0012", note: "Symmetric reference", design: { ...base, family: "4", naca4: { M: 0, P: 0, T: 12 } } },
  { name: "NACA 2412", note: "General aviation classic", design: { ...base, family: "4", naca4: { M: 2, P: 4, T: 12 } } },
  { name: "NACA 4412", note: "High-lift cambered", design: { ...base, family: "4", naca4: { M: 4, P: 4, T: 12 } } },
  { name: "NACA 6409", note: "Thin, strongly cambered", design: { ...base, family: "4", naca4: { M: 6, P: 4, T: 9 } } },
  { name: "NACA 0018", note: "Thick symmetric", design: { ...base, family: "4", naca4: { M: 0, P: 0, T: 18 } } },
  { name: "NACA 23012", note: "Forward-camber 5-digit", design: { ...base, family: "5", naca5: { L: 2, P: 3, Q: 0, T: 12 } } },
  { name: "NACA 23112", note: "Reflexed, low pitching moment", design: { ...base, family: "5", naca5: { L: 2, P: 3, Q: 1, T: 12 } } },
  { name: "NACA 44015", note: "High design lift 5-digit", design: { ...base, family: "5", naca5: { L: 4, P: 4, Q: 0, T: 15 } } },
];
