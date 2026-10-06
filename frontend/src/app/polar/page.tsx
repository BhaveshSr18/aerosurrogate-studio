import type { Metadata } from "next";
import { PolarView } from "./polar-view";

export const metadata: Metadata = { title: "Polars" };

export default function PolarPage() {
  return <PolarView />;
}
