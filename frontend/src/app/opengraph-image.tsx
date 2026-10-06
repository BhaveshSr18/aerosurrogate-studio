import { ImageResponse } from "next/og";
import { SITE_NAME } from "@/lib/site";

export const alt = `${SITE_NAME}: airfoil design with a CFD surrogate`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Share-preview card: a cambered airfoil with streamlines, drawn as SVG paths. */
export default function OpengraphImage() {
  const lines = Array.from({ length: 9 }, (_, i) => {
    const y = 120 + i * 48;
    const bump = Math.max(0, 60 - Math.abs(y - 330) * 0.35);
    return `M0 ${y} C 300 ${y} 420 ${y - bump} 600 ${y - bump * 0.9} S 900 ${y + 10} 1200 ${y + 20}`;
  });
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#111110", color: "#ecebe6", padding: 72, position: "relative" }}>
        <svg width="1200" height="630" viewBox="0 0 1200 630" style={{ position: "absolute", left: 0, top: 0 }}>
          {lines.map((d, i) => (
            <path key={i} d={d} stroke="#3987e5" strokeOpacity={0.35} strokeWidth={2} fill="none" />
          ))}
          <path d="M420 340 C 470 290 620 285 800 318 C 700 330 560 350 420 352 Z" fill="#2c2c2a" stroke="#c3c2b7" strokeWidth={2} />
        </svg>
        <div style={{ display: "flex", fontSize: 28, color: "#3987e5", fontWeight: 600 }}>{SITE_NAME}</div>
        <div style={{ display: "flex", marginTop: 16, fontSize: 60, fontWeight: 700, lineHeight: 1.1, maxWidth: 900 }}>
          Airfoil design at CFD fidelity, in the browser
        </div>
        <div style={{ display: "flex", marginTop: "auto", fontSize: 26, color: "#a3a29b" }}>
          MeshGraphNet surrogate · AirfRANS k-ω SST · polars · optimization
        </div>
      </div>
    ),
    size,
  );
}
