import { cookies } from "next/headers";
import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { visibleSections } from "@/lib/console-nav";
import { LANG_COOKIE, parseLang } from "@/lib/i18n";
import { SECTION_FEATURE } from "@/lib/plan-features";
import { canSee } from "@/lib/staff-permissions";
import { tenantFeatures, tenantPlanName } from "@/server/plan";
import { outletsFor } from "@/server/staff/auth";
import { currentStaff } from "@/server/staff/request";
import { StaffShell } from "./_components/staff-shell";
import { tenantAccess } from "@/server/access";
import { getGuide } from "@/server/staff/guide";
import { Guide } from "./_components/guide/guide";
import { AccessBanner, PausedScreen } from "./_components/access-notice";
import { outletLogoFor } from "@/server/staff/settings-read";
import { staffAppMetadataFor, staffAppViewportFor } from "@/lib/staff-app";
import { staffAppBrandForOutletCode } from "@/server/staff/pwa-branding";
import { cache } from "react";
import { StaffPrintProvider } from "@/components/print/staff-print-provider";

const consoleAppBrand = cache(async () => {
  const staff = await currentStaff();
  return staffAppBrandForOutletCode(staff?.outlet.code);
});

export async function generateMetadata(): Promise<Metadata> {
  return staffAppMetadataFor(await consoleAppBrand());
}

export async function generateViewport(): Promise<Viewport> {
  return { ...staffAppViewportFor(await consoleAppBrand()), viewportFit: "cover" };
}

// Staff console: sign-in first, then a sidebar showing only what this role may open (UI spec 3.5).
export default async function ConsoleLayout({ children }: LayoutProps<"/console">) {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  const jar = await cookies();
  const lang = parseLang(jar.get(LANG_COOKIE)?.value);
  const theme = jar.get("tq_theme")?.value === "dark" ? "dark" : "light";
  const sidebar = jar.get("tq_sidebar")?.value === "folded" ? "folded" : "open";
  // The kitchen board is a button in the top bar, not a sidebar row
  // Sections outside the plan are left out of the menu; My plan shows what more there is
  const [features, outlets, access, planName, guide, logoUrl] = await Promise.all([tenantFeatures(staff.tenantId), outletsFor(staff), tenantAccess(staff.tenantId), tenantPlanName(staff.tenantId), getGuide(staff), outletLogoFor(staff)]);
  const canAsk = staff.roles.some((r) => r === "owner" || r === "manager");
  if (access.state === "blocked") return <PausedScreen access={access} canAsk={canAsk} staff={staff} />;
  const sections = visibleSections
    .filter((s) => s.slug !== "kitchen" && canSee(staff, s.slug))
    .map((s) => {
      const needs = SECTION_FEATURE[s.slug];
      return { slug: s.slug, label: lang === "hi" ? s.hi : s.label, inPlan: !needs || features[needs] };
    })
    .filter((s) => s.inPlan)
    .map(({ slug, label }) => ({ slug, label }));
  const kitchen = canSee(staff, "kitchen");
  return (
    <StaffShell theme={theme} sidebar={sidebar} lang={lang} sections={sections} kitchen={kitchen} plan={planName ? { name: planName, canManage: canAsk } : undefined} logoUrl={logoUrl} outlets={outlets.map((o) => ({ id: o.id, name: o.name, current: o.id === staff.outletId }))} staff={{ name: staff.name, roles: staff.roles, outlet: staff.outlet.name, shiftEnds: staff.expiresAt }}>
      <StaffPrintProvider outletId={staff.outletId}>
        <AccessBanner access={access} canAsk={canAsk} outlet={staff.outlet.name} />
        {children}
      </StaffPrintProvider>
      <Guide lang={lang} name={staff.name} sections={sections} kitchen={kitchen} welcomeSeen={!!guide.welcome} />
    </StaffShell>
  );
}
