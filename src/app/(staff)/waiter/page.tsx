import type { Metadata } from "next";

export const metadata: Metadata = { title: "My floor" };

// S3 Waiter phone. Tasks first, bottom tabs.
export default function WaiterPage() {
  return (
    <main className="mx-auto w-full max-w-[480px] px-5 py-10">
      <h1 className="font-display text-title font-medium">My floor</h1>
      <p className="mt-2 text-muted">Placeholder for screen S3.</p>
    </main>
  );
}
