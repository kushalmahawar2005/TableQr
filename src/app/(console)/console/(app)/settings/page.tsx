import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canSee } from "@/lib/staff-permissions";
import { getOutletSettings } from "@/server/staff/settings-read";
import { currentStaff } from "@/server/staff/request";
import { SettingsScreen } from "./_components/settings-screen";
import { CustomDomainSettings } from "./_components/custom-domain-settings";

export const metadata: Metadata = { title: "Settings", robots: { index: false, follow: false } };

export default async function SettingsPage() {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  if (!canSee(staff.roles, "settings")) {
    return <main className="p-8"><h1 className="font-display text-title font-bold text-ink">You don&apos;t have access to settings.</h1><p className="mt-2 text-body text-muted">Ask an owner if you need it.</p></main>;
  }
  const o = await getOutletSettings(staff);
  const canEdit = staff.roles.includes("owner");
  return <><SettingsScreen o={o} canEdit={canEdit} /><div className="mx-auto w-full px-4 pb-8 sm:px-6"><CustomDomainSettings domain={o.customDomain} token={canEdit ? o.customDomainToken : null} verifiedAt={o.customDomainVerifiedAt} canEdit={canEdit} /></div></>;
}
