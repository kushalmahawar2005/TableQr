import type { Metadata } from "next";

export const metadata: Metadata = { title: "Kitchen" };

// S2 Kitchen display. Locked full-screen mode, dark theme, no sidebar.
export default function KitchenDisplayPage() {
  return (
    <main className="flex flex-1 flex-col bg-kds-bg p-6 text-white">
      <h1 className="font-display text-title font-medium">Kitchen</h1>
      <p className="mt-2 text-kds text-white/70">Placeholder for screen S2.</p>
    </main>
  );
}
