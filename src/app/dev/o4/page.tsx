import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PricingScreen } from "@/app/(console)/console/(app)/pricing/_components/pricing-screen";
import { CartScreen } from "@/app/(guest)/r/[outlet]/t/[table]/cart/_components/cart-screen";
import { pricingCases } from "./_fixtures";

export const metadata: Metadata = { title: "O4 Pricing states (dev)", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Development-only review board for O4 Pricing: the real screens with sample data, one state per
// page (?solo=<id>). Actions are off in preview.
export default async function PricingBoard(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const q = await props.searchParams;
  const cases = pricingCases();
  const solo = cases.find((c) => c.id === q.solo);
  if (!solo) {
    return (
      <main className="p-6">
        <h1 className="font-display text-title font-bold">O4 Pricing</h1>
        <p className="text-caption text-muted">Development review board. Sample data. Open a state:</p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-3">
          {cases.map((c) => (
            <li key={c.id}>
              <Link className="inline-flex min-h-11 items-center underline" href={`?solo=${c.id}`}>
                {c.label}
              </Link>
            </li>
          ))}
        </ul>
      </main>
    );
  }
  return (
    <>
      <p className="px-5 pt-3 text-caption">
        <Link href="/dev/o4" className="underline">
          ← All states
        </Link>{" "}
        · {solo.label}
      </p>
      {solo.kind === "pricing" ? (
        <PricingScreen key={solo.id} initial={solo.data} preview={solo.preview} />
      ) : (
        <div className="relative mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-4 min-[360px]:px-5">
          <CartScreen data={solo.data} lang="en" shortCode="k7Qm" fromMenu realtimeUrl={null} preview={solo.preview} />
        </div>
      )}
    </>
  );
}
