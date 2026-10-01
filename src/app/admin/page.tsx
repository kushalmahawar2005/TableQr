import type { Metadata } from "next";

export const metadata: Metadata = { title: "Admin" };

// Platform admin console for the TableQR team: tenants, plans, usage, support.
export default function AdminPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <h1 className="font-display text-title font-medium">Platform admin</h1>
      <p className="mt-2 text-muted">Placeholder.</p>
    </main>
  );
}
