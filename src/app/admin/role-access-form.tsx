"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { visibleSections } from "@/lib/console-nav";
import { assignableRoles, sectionRoles, staffRoles, type ConsoleSectionSlug, type RoleAccess, type StaffRole } from "@/lib/staff-permissions";

const ROLE_LABELS: Record<StaffRole, string> = { owner: "Owner", manager: "Manager", cashier: "Cashier", host: "Host", waiter: "Waiter", kitchen: "Kitchen", accountant: "Accountant", reception: "Reception", rider: "Rider" };
const GRID_ROLES = staffRoles.filter((r) => r !== "owner");

type Grid = Record<ConsoleSectionSlug, StaffRole[]>;
const gridFor = (access: RoleAccess | null) =>
  Object.fromEntries(visibleSections.map((s) => [s.slug, sectionRoles(s.slug, access).filter((r) => r !== "owner")])) as Grid;

/** Which sections each staff role opens at one restaurant: pick a role, tick its sections. The owner always has all of them. */
export function RoleAccessForm({ roleAccess, pending, onSave }: { roleAccess: RoleAccess | null; pending: boolean; onSave: (access: RoleAccess) => void }) {
  const [grid, setGrid] = useState(() => gridFor(roleAccess));
  const [role, setRole] = useState<StaffRole>(GRID_ROLES[0]);
  const toggle = (slug: ConsoleSectionSlug) =>
    setGrid((g) => ({ ...g, [slug]: g[slug].includes(role) ? g[slug].filter((r) => r !== role) : [...g[slug], role] }));
  const sections = visibleSections.filter((s) => assignableRoles(s.slug).includes(role));
  const count = (r: StaffRole) => visibleSections.filter((s) => grid[s.slug].includes(r)).length;
  return (
    <div className="space-y-3">
      <div role="group" aria-label="Staff role" className="no-scrollbar flex gap-1.5 overflow-x-auto">
        {GRID_ROLES.map((r) => <button key={r} type="button" aria-pressed={role === r} onClick={() => setRole(r)} className={`h-9 shrink-0 whitespace-nowrap rounded-full border px-3 text-[13px] font-semibold ${role === r ? "border-transparent bg-[var(--admin-brand)] text-white" : "bg-card text-muted-foreground hover:text-foreground"}`}>{ROLE_LABELS[r]} {count(r)}</button>)}
      </div>
      <div className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
        {sections.map((s) => <label key={s.slug} className="flex min-h-10 items-center gap-2.5 text-sm"><input type="checkbox" checked={grid[s.slug].includes(role)} onChange={() => toggle(s.slug)} className="size-4 accent-[var(--admin-brand)]" />{s.label}</label>)}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={() => onSave(grid)}>{pending && <Loader2 className="animate-spin" />}Save</Button>
        <Button variant="outline" disabled={pending} onClick={() => { setGrid(gridFor(null)); onSave({}); }}>Back to defaults</Button>
      </div>
    </div>
  );
}
