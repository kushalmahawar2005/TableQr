import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingClient } from "./booking-client";
import { getBookingPageConfig } from "@/server/booking/core";
import { AppError } from "@/server/errors";

export const metadata: Metadata = { title: "Book a table" };

// B1 Guests, date and time. Reached from the entrance QR or the booking link.
export default async function BookPage(props: PageProps<"/r/[outlet]/book">) {
  const { outlet } = await props.params;
  const query = await props.searchParams;
  const hindi = query.lang === "hi";
  const config = await getBookingPageConfig(outlet).catch((e: unknown) => {
    if (e instanceof AppError && e.code === "forbidden") return null;
    if (e instanceof AppError && (e.code === "not_found" || e.code === "outlet_unavailable")) notFound();
    throw e;
  });
  // The restaurant's plan has no online booking
  if (!config) {
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-center text-ink">
        <div className="max-w-md">
          <Link href={`/r/${encodeURIComponent(outlet)}`} className="mb-5 inline-flex min-h-11 items-center text-sm font-semibold text-brand-strong">← {hindi ? "रेस्टोरेंट पर वापस जाएँ" : "Back to restaurant"}</Link>
          <h1 className="font-display text-title font-bold text-ink">Online booking is not available here</h1>
          <p className="mt-2 text-body text-muted">{hindi ? "टेबल बुक करने के लिए कृपया रेस्टोरेंट को कॉल करें।" : "Please call the restaurant to book a table."}</p>
        </div>
      </main>
    );
  }
  return <BookingClient outletCode={outlet} zones={config.zones} timezone={config.timezone} today={config.today} freeCancellationMinutes={config.freeCancellationMinutes} hindi={hindi} />;
}
