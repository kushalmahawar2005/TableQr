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
  const token = typeof query.token === "string" ? query.token : "";
  let zones: Awaited<ReturnType<typeof getBookingZones>>;

  try {
    zones = await getBookingZones(outlet);
  } catch (error) {
    // Someone already in the queue can still follow their place after online booking is switched off
    if (error instanceof AppError && error.code === "forbidden" && token) zones = [];
    else if (error instanceof AppError && error.code === "forbidden") {
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
    else if (error instanceof AppError && (error.code === "not_found" || error.code === "outlet_unavailable")) notFound();
    else throw error;
  }

  return (
    <WaitlistClient
      outlet={outlet}
      zones={zones}
      token={token}
      realtimeUrl={process.env.REALTIME_URL?.replace(/^http/, "ws") ?? null}
    />
  );
}
