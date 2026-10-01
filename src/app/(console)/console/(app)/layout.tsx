import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { consoleSections } from "@/lib/console-nav";
import { LANG_COOKIE, parseLang } from "@/lib/i18n";
import { canSee } from "@/lib/staff-permissions";
import { currentStaff } from "@/server/staff/request";
import { StaffShell } from "./_components/staff-shell";

// Staff console: sign-in first, then a sidebar showing only what this role may open (UI spec 3.5).
export default async function ConsoleLayout({ children }: LayoutProps<"/console">) {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  const lang = parseLang((await cookies()).get(LANG_COOKIE)?.value);
  const sections = consoleSections.filter((s) => canSee(staff.roles, s.slug)).map((s) => ({ slug: s.slug, label: lang === "hi" ? s.hi : s.label }));
  return (
    <StaffShell lang={lang} sections={sections} staff={{ name: staff.name, roles: staff.roles, outlet: staff.outlet.name, shiftEnds: staff.expiresAt }}>
      {children}
    </StaffShell>
  );
}
