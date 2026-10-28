import type { Metadata } from "next";
import Link from "next/link";
import { InstallApp } from "@/components/install-app";

export const metadata: Metadata = {
  title: "Get the Tableeqr Apps",
  description: "Install the Tableeqr staff app or download the separate Rider app.",
};

export default function DownloadPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center px-5 py-10 text-ink">
      <header className="text-center">
        <p className="text-caption font-bold uppercase tracking-[0.18em] text-muted">Tableeqr</p>
        <h1 className="mt-2 font-display text-3xl font-bold">Choose your app</h1>
        <p className="mt-2 text-body text-muted">One staff app for restaurant roles. Riders use their separate app.</p>
      </header>
      <div className="mt-7 grid gap-4 sm:grid-cols-2">
        <section className="rounded-3xl border border-line bg-surface p-5 shadow-sm">
          <span aria-hidden className="grid size-14 place-items-center rounded-2xl bg-ink text-xl font-bold text-white">T</span>
          <h2 className="mt-4 font-display text-xl font-bold">Tableeqr Staff</h2>
          <p className="mt-1 min-h-12 text-caption text-muted">Owner, manager, accountant, host, cashier, waiter and kitchen access in one app.</p>
          <InstallApp className="mt-4" name="Tableeqr Staff" title="Install the staff app" blurb="Add the staff app to your home screen. Sign in with your restaurant outlet code, phone and PIN." />
          <Link href="/console/login" className="mt-3 flex min-h-11 items-center justify-center rounded-xl border border-line px-4 text-body font-semibold">Open staff sign in</Link>
          <p className="mt-3 text-caption text-muted">On iPhone/iPad: open in Safari, tap Share, then Add to Home Screen. On Android or desktop: use the browser’s Install option.</p>
        </section>
        <section className="rounded-3xl border border-line bg-surface p-5 shadow-sm">
          <span aria-hidden className="grid size-14 place-items-center rounded-2xl bg-[#c9482b] text-2xl">🛵</span>
          <h2 className="mt-4 font-display text-xl font-bold">Tableeqr Rider</h2>
          <p className="mt-1 min-h-12 text-caption text-muted">A separate Android app for delivery riders and live delivery work.</p>
          <Link href="/download/rider" className="mt-4 flex min-h-12 items-center justify-center rounded-xl bg-[#c9482b] px-4 font-semibold text-white">Rider app download page</Link>
          <p className="mt-3 text-caption text-muted">The latest Android release is shown there when one has been uploaded. Riders sign in with the phone and PIN assigned by the restaurant.</p>
        </section>
      </div>
      <p className="mt-6 text-center text-caption text-muted">Need access? Ask your restaurant owner to create your staff or rider account.</p>
    </main>
  );
}
