import type { ComponentProps } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StaffShell } from "@/app/(console)/console/(app)/_components/staff-shell";
import { TeamScreen } from "@/app/(console)/console/(app)/team/_components/team-screen";
import { consoleSections } from "@/lib/console-nav";

export const metadata: Metadata = { title: "Team (dev)", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Props = ComponentProps<typeof TeamScreen>;
const person = (id: string, name: string, roles: string[], over: Record<string, unknown> = {}) => ({ id, name, phone: "+91 98765 43210", roles, isActive: true, isMe: false, locked: false, photoUrl: null, ...over });
const initial = [
  person("1", "Kushal Mahawar", ["owner"], { isMe: true, locked: true }),
  person("2", "Rohan Sharma", ["manager"]),
  person("3", "Anjali Mehta with a much longer name", ["waiter"]),
  person("4", "Dev Joshi", ["kitchen"]),
  person("5", "Ravi", ["rider"], { isActive: false }),
] as unknown as Props["initial"];
const duty = [
  { id: "2", name: "Rohan Sharma", roles: ["manager"], status: "on", online: true, lastSeenAt: Date.now(), since: Date.now() },
  { id: "3", name: "Anjali Mehta with a much longer name", roles: ["waiter"], status: "break", online: false, lastSeenAt: Date.now() - 3_600_000, since: Date.now() },
  { id: "4", name: "Dev Joshi", roles: ["kitchen"], status: "off", online: false, lastSeenAt: null, since: null },
] as unknown as NonNullable<Props["duty"]>;
const invitations = [{ id: "i1", phone: "+91 90000 00000", role: "waiter", expiresAt: Date.now() + 86_400_000, createdAt: Date.now() }] as unknown as NonNullable<Props["invitations"]>;

// Development-only review board for the Team screen, with sample data
export default function TeamBoard() {
  if (process.env.NODE_ENV === "production") notFound();
  const sections = consoleSections.map((s) => ({ slug: s.slug, label: s.label }));
  return (
    <StaffShell lang="en" sections={sections} staff={{ name: "Owner", roles: ["owner"], outlet: "Spice Route", shiftEnds: null }} activeSlug="team" preview>
      <TeamScreen initial={initial} invitations={invitations} canEdit canChangeDuty duty={duty} outletCode="SRJ01" outletName="Spice Route" roles={["manager", "waiter", "kitchen", "rider", "accountant"]} />
    </StaffShell>
  );
}
