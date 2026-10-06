import type { Metadata } from "next";
import { StudioView } from "./studio-view";

export const metadata: Metadata = { title: "Design Studio" };

export default function StudioPage() {
  return <StudioView />;
}
