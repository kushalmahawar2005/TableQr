import type { Metadata } from "next";
import { BookingClient } from "./booking-client";
import { getBookingZones } from "@/server/booking/core";
import { AppError } from "@/server/errors";

export const metadata: Metadata = { title: "Book a table" };

// B1 Guests, date and time. Reached from the entrance QR or the booking link.
export default async function BookPage(props: PageProps<"/r/[outlet]/book">) {
  const { outlet } = await props.params;
  const zones = await getBookingZones(outlet).catch((e: unknown) => {
    if (e instanceof AppError && e.code === "forbidden") return null;
    throw e;
  });
  // The restaurant's plan has no online booking
  if (!zones) {
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-center">
        <div>
          <h1 className="font-display text-title font-bold text-ink">Online booking is not available here</h1>
          <p className="mt-2 text-body text-muted">Please call the restaurant to book a table.</p>
        </div>
      </main>
    );
  }
  return <BookingClient outletCode={outlet} zones={zones} />;
}
