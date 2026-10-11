import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { visibleSections } from "@/lib/console-nav";
import { LANG_COOKIE, parseLang } from "@/lib/i18n";
import { canSee } from "@/lib/staff-permissions";
import { currentStaff } from "@/server/staff/request";
import { StaffShell } from "./_components/staff-shell";

// Staff console: sign-in first, then a sidebar showing only what this role may open (UI spec 3.5).
export default async function ConsoleLayout({ children }: LayoutProps<"/console">) {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  const jar = await cookies();
  const lang = parseLang(jar.get(LANG_COOKIE)?.value);
  const theme = jar.get("tq_theme")?.value === "dark" ? "dark" : "light";
  // The kitchen board is a button in the top bar, not a sidebar row
  const sections = visibleSections.filter((s) => s.slug !== "kitchen" && canSee(staff.roles, s.slug)).map((s) => ({ slug: s.slug, label: lang === "hi" ? s.hi : s.label }));
  const kitchen = canSee(staff.roles, "kitchen");
  return (
    <StaffShell theme={theme} lang={lang} sections={sections} kitchen={kitchen} staff={{ name: staff.name, roles: staff.roles, outlet: staff.outlet.name, shiftEnds: staff.expiresAt }}>
      {children}
    </StaffShell>
  );
}
