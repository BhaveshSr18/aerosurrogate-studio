"use client";

/** Last-resort boundary for errors in the root layout itself; it replaces <html>, so no app styles. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#111110", color: "#ecebe6", textAlign: "center", padding: "6rem 1rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>AeroSurrogate Studio failed to load</h1>
        <p style={{ color: "#a3a29b", fontSize: "0.875rem" }}>Reload the page. If it keeps failing, clear this site&apos;s data in your browser.</p>
        <button
          onClick={reset}
          style={{ marginTop: "1.5rem", padding: "0.5rem 1rem", borderRadius: 8, border: 0, background: "#3987e5", color: "#fff", cursor: "pointer" }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
