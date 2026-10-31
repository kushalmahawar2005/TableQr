import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppError } from "@/server/errors";
import { guestBase } from "@/server/guest/guest-base";
import { getBookingZones } from "@/server/booking/core";
import { WaitlistClient } from "./waitlist-client";

export const metadata: Metadata = { title: "Waitlist", robots: { index: false, follow: false } };

export default async function WaitlistPage(props: PageProps<"/r/[outlet]/waitlist">) {
  const { outlet } = await props.params;
  const query = await props.searchParams;
  let zones;

  try {
    zones = await getBookingZones(outlet);
  } catch (error) {
    if (error instanceof AppError && error.code === "forbidden") {
      return (
        <main className="mx-auto grid min-h-[70dvh] max-w-[520px] place-items-center px-5 py-10 text-center text-ink">
          <div>
            <h1 className="font-display text-2xl font-bold">Online waitlist is not available here</h1>
            <p className="mt-2 text-sm text-muted">Please contact the restaurant to join the waitlist.</p>
            <Link href={await guestBase(outlet)} className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-brand px-4 font-semibold text-brand-on">
              Back to restaurant
            </Link>
          </div>
        </main>
      );
    }
    if (error instanceof AppError && (error.code === "not_found" || error.code === "outlet_unavailable")) notFound();
    throw error;
  }

  return (
    <WaitlistClient
      outlet={outlet}
      zones={zones}
      token={typeof query.token === "string" ? query.token : ""}
      realtimeUrl={process.env.REALTIME_URL?.replace(/^http/, "ws") ?? null}
    />
  );
}
