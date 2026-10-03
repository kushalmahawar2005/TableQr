import type { Metadata } from "next";
import { BookingClient } from "./booking-client";

export const metadata: Metadata = { title: "Book a table" };

// B1 Guests, date and time. Reached from the entrance QR or the booking link.
export default async function BookPage(props: PageProps<"/r/[outlet]/book">) {
  const { outlet } = await props.params;
  return <BookingClient outletCode={outlet} />;
}
