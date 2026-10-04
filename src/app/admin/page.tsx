import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { currentPlatformAdmin } from "@/server/admin/auth";
import { AdminLogin, CreateTenantForm } from "./admin-client";
import { adminLogoutAction } from "./actions";

export const metadata: Metadata = { title: "Platform admin", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const admin = await currentPlatformAdmin();
  if (!admin) return <main className="grid min-h-dvh place-items-center bg-paper px-4"><AdminLogin /></main>;
  const [plans, tenants] = await Promise.all([
    db.select({ code: s.plans.code, name: s.plans.name }).from(s.plans).where(eq(s.plans.isPublic, true)),
    db.select({ id: s.tenants.id, name: s.tenants.name, status: s.tenants.status, planCode: s.tenants.planCode, contactName: s.tenants.contactName, createdAt: s.tenants.createdAt }).from(s.tenants),
  ]);
  return <main className="mx-auto w-full max-w-6xl px-5 py-8">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-body text-muted">Signed in as {admin.email}</p><h1 className="font-display text-title font-medium">Platform admin</h1><p className="mt-1 text-muted">Create and manage restaurant accounts.</p></div>
      <form action={adminLogoutAction}><button className="rounded-input border border-line px-4 py-2 text-button">Sign out</button></form>
    </header>
    <section className="mt-8"><CreateTenantForm plans={plans} /></section>
    <section className="mt-8 rounded-card border border-line bg-surface p-5">
      <h2 className="font-display text-section font-medium">Restaurants ({tenants.length})</h2>
      {tenants.length === 0 ? <p className="mt-3 text-muted">No restaurants created yet.</p> : <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-body"><thead><tr className="border-b border-line text-muted"><th className="py-2 pr-4">Name</th><th className="py-2 pr-4">Plan</th><th className="py-2 pr-4">Status</th><th className="py-2">Contact</th></tr></thead><tbody>{tenants.map((tenant) => <tr key={tenant.id} className="border-b border-line last:border-0"><td className="py-3 pr-4 font-semibold">{tenant.name}</td><td className="py-3 pr-4">{tenant.planCode}</td><td className="py-3 pr-4">{tenant.status}</td><td className="py-3">{tenant.contactName}</td></tr>)}</tbody></table></div>}
    </section>
  </main>;
}
