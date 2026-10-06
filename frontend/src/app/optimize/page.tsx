import type { Metadata } from "next";
import { OptimizeView } from "./optimize-view";

export const metadata: Metadata = { title: "Optimizer" };

export default function OptimizePage() {
  return <OptimizeView />;
}
