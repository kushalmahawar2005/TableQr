import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-5 text-center text-ink">
      <div className="max-w-sm">
        <p className="font-display text-6xl font-extrabold text-brand">404</p>
        <h1 className="mt-3 font-display text-title font-bold">We can&apos;t find that page</h1>
        <p className="mt-2 text-body text-muted">The link may be old or mistyped. If you scanned a QR code at a table, please scan it again or ask the staff.</p>
        <Link href="/" className="mt-6 inline-block rounded-input bg-brand px-6 py-3 text-button font-bold text-white hover:bg-brand-strong">Go to home</Link>
      </div>
    </main>
  );
}
