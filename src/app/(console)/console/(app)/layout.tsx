import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { visibleSections } from "@/lib/console-nav";
import { LANG_COOKIE, parseLang } from "@/lib/i18n";
import { SECTION_FEATURE } from "@/lib/plan-features";
import { canSee } from "@/lib/staff-permissions";
import { tenantFeatures } from "@/server/plan";
import { outletsFor } from "@/server/staff/auth";
import { currentStaff } from "@/server/staff/request";
import { StaffShell } from "./_components/staff-shell";
import { tenantAccess } from "@/server/access";
import { AccessBanner, PausedScreen } from "./_components/access-notice";

// Staff console: sign-in first, then a sidebar showing only what this role may open (UI spec 3.5).
export default async function ConsoleLayout({ children }: LayoutProps<"/console">) {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  const jar = await cookies();
  const lang = parseLang(jar.get(LANG_COOKIE)?.value);
  const theme = jar.get("tq_theme")?.value === "dark" ? "dark" : "light";
  // The kitchen board is a button in the top bar, not a sidebar row
  // Sections outside the plan stay in the menu with a lock, so the owner knows they exist
  const [features, outlets, access] = await Promise.all([tenantFeatures(staff.tenantId), outletsFor(staff), tenantAccess(staff.tenantId)]);
  const canAsk = staff.roles.some((r) => r === "owner" || r === "manager");
  if (access.state === "blocked") return <PausedScreen access={access} canAsk={canAsk} staff={staff} />;
  const sections = visibleSections
    .filter((s) => s.slug !== "kitchen" && canSee(staff.roles, s.slug))
    .map((s) => {
      const needs = SECTION_FEATURE[s.slug];
      return { slug: s.slug, label: lang === "hi" ? s.hi : s.label, locked: !!needs && !features[needs] };
    });
  const kitchen = canSee(staff.roles, "kitchen");
  return (
    <StaffShell theme={theme} lang={lang} sections={sections} kitchen={kitchen} outlets={outlets.map((o) => ({ id: o.id, name: o.name, current: o.id === staff.outletId }))} staff={{ name: staff.name, roles: staff.roles, outlet: staff.outlet.name, shiftEnds: staff.expiresAt }}>
      <AccessBanner access={access} canAsk={canAsk} outlet={staff.outlet.name} />
      {children}
    </StaffShell>
  );
}
