import type { Metadata } from "next";

export const metadata: Metadata = { title: "Book a table" };

// B1 Guests, date and time. Reached from the entrance QR or the booking link.
export default async function BookPage(props: PageProps<"/r/[outlet]/book">) {
  const { outlet } = await props.params;

  return (
    <main className="py-10">
      <h1 className="font-display text-title font-medium">Book a table</h1>
      <p className="mt-2 text-muted">
        Outlet {outlet}. Placeholder for screen B1.
      </p>
    </main>
  );
}
