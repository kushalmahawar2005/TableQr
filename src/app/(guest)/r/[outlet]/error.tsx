"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle, RotateCw, Store } from "lucide-react";
import { useGuestExperience } from "./guest-shell";

export default function GuestRouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const pathname = usePathname();
  const { brand, language } = useGuestExperience();
  const hindi = language === "hi";
  const homePath = pathname.match(/^(\/r\/[^/]+(?:\/app)?)(?:\/|$)/)?.[1] ?? "/";

  useEffect(() => {
    console.error("Guest route failed", error);
  }, [error]);

  return (
    <main className="mx-auto grid min-h-[70dvh] w-full max-w-[520px] place-items-center px-5 py-10 text-center text-ink" role="alert">
      <section className="w-full rounded-3xl border border-line bg-surface p-6 shadow-sm sm:p-8">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-danger/10 text-danger">
          <AlertTriangle size={26} aria-hidden />
        </span>
        <h1 className="mt-5 font-display text-2xl font-bold">{hindi ? "यह पेज अभी नहीं खुल पाया" : "This page could not load"}</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted">
          {hindi
            ? "कनेक्शन जाँचें और फिर कोशिश करें। समस्या बनी रहे तो नीचे दिया रेफ़रेंस रेस्टोरेंट को भेजें।"
            : "Check your connection and try again. If it keeps happening, share the reference below with the restaurant."}
        </p>
        {error.digest && <p className="mt-4 break-all rounded-xl bg-paper px-3 py-2 font-mono text-xs text-muted">{hindi ? "रेफ़रेंस" : "Reference"}: {error.digest}</p>}
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={retry} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand px-4 font-semibold text-brand-on hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            <RotateCw size={17} aria-hidden />{hindi ? "फिर कोशिश करें" : "Try again"}
          </button>
          <Link href={homePath} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line px-4 font-semibold hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            <Store size={17} aria-hidden />{hindi ? `${brand?.outlet.name ?? "रेस्टोरेंट"} पर वापस जाएँ` : `Back to ${brand?.outlet.name ?? "restaurant"}`}
          </Link>
        </div>
      </section>
    </main>
  );
}
