import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BillingScreen } from "@/app/pos/_components/billing-screen";
import { canSee } from "@/lib/staff-permissions";
import { posQueue } from "@/server/staff/pos-read";
import { currentStaff } from "@/server/staff/request";

export const metadata: Metadata = { title: "Billing", robots: { index: false, follow: false } };

// Billing is the cashier POS inside the console frame: same read model and actions as /pos.
export default async function BillingPage(props: { searchParams: Promise<{ session?: string }> }) {
  const { session } = await props.searchParams;
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  if (!canSee(staff, "billing")) {
    return (
      <main className="p-8">
        <h1 className="font-display text-title font-bold text-ink">You don&apos;t have access to billing.</h1>
        <p className="mt-2 text-body text-muted">Ask an owner if you need it.</p>
      </main>
    );
  }
  return <BillingScreen embedded openSession={typeof session === "string" ? session : null} initial={await posQueue(staff)} realtimeUrl={process.env.NEXT_PUBLIC_REALTIME_URL ?? null} />;
}
