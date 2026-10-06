import type { Metadata } from "next";
import { CompareView } from "./compare-view";

export const metadata: Metadata = { title: "Compare" };

export default function ComparePage() {
  return <CompareView />;
}
