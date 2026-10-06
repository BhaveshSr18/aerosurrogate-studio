import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <div className="tabular font-mono text-sm text-muted">404</div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Flow separated from this page</h1>
      <p className="mt-2 text-sm text-muted">The page you are looking for does not exist.</p>
      <Link href="/" className={buttonClass("primary", "md", "mt-6")}>
        Back to home
      </Link>
    </div>
  );
}
