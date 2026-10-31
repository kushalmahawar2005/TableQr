"use client";

import Link from "next/link";

export default function GlobalRouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const reference = typeof error?.digest === "string" ? error.digest : null;

  return (
    <main role="alert" className="grid min-h-dvh place-items-center bg-paper px-5 text-center text-ink">
      <div className="max-w-sm">
        <h1 className="font-display text-title font-bold">Something went wrong</h1>
        <p className="mt-2 text-body text-muted">This page could not load. Please try again. If it keeps happening, share the error reference with your Tableeqr contact.</p>
        {reference && <p className="mt-3 break-all font-mono text-label text-muted">Error reference: {reference}</p>}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={reset} className="rounded-input bg-ink px-6 py-3 text-button font-bold text-white hover:bg-ink/90">Try again</button>
          <Link href="/" className="rounded-input border border-line bg-surface px-6 py-3 text-button font-bold hover:bg-white">Home</Link>
        </div>
      </div>
    </main>
  );
}
