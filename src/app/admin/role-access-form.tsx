"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { visibleSections } from "@/lib/console-nav";
import { assignableRoles, sectionRoles, staffRoles, type ConsoleSectionSlug, type RoleAccess, type StaffRole } from "@/lib/staff-permissions";

const ROLE_LABELS: Record<StaffRole, string> = { owner: "Owner", manager: "Manager", cashier: "Cashier", host: "Host", waiter: "Waiter", kitchen: "Kitchen", accountant: "Accountant", reception: "Reception" };
const GRID_ROLES = staffRoles.filter((r) => r !== "owner");

type Grid = Record<ConsoleSectionSlug, StaffRole[]>;
const gridFor = (access: RoleAccess | null) =>
  Object.fromEntries(visibleSections.map((s) => [s.slug, sectionRoles(s.slug, access).filter((r) => r !== "owner")])) as Grid;

/** Which staff role opens which console section at one restaurant. The owner always has all of them. */
export function RoleAccessForm({ roleAccess, pending, onSave }: { roleAccess: RoleAccess | null; pending: boolean; onSave: (access: RoleAccess) => void }) {
  const [grid, setGrid] = useState(() => gridFor(roleAccess));
  const toggle = (slug: ConsoleSectionSlug, role: StaffRole) =>
    setGrid((g) => ({ ...g, [slug]: g[slug].includes(role) ? g[slug].filter((r) => r !== role) : [...g[slug], role] }));
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Roles</h3>
        <p className="text-xs text-muted-foreground">Tick which staff role can open each section at this restaurant. The owner always sees everything. Dashboard, Reports and Customers can go to any role; other sections only to the roles that run them.</p>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[560px] text-xs">
          <thead>
            <tr className="bg-muted/60 text-left">
              <th className="px-2 py-1.5 font-semibold">Section</th>
              {GRID_ROLES.map((r) => <th key={r} className="px-1 py-1.5 text-center font-semibold">{ROLE_LABELS[r]}</th>)}
            </tr>
          </thead>
          <tbody>
            {visibleSections.map((s) => (
              <tr key={s.slug} className="border-t">
                <td className="px-2 py-1.5 font-medium">{s.label}</td>
                {GRID_ROLES.map((r) => (
                  <td key={r} className="px-1 py-1.5 text-center">
                    {assignableRoles(s.slug).includes(r)
                      ? <input type="checkbox" aria-label={`${ROLE_LABELS[r]} can open ${s.label}`} checked={grid[s.slug].includes(r)} onChange={() => toggle(s.slug, r)} className="size-4 accent-[#5b42f5]" />
                      : <span className="text-muted-foreground" aria-hidden>·</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={() => onSave(grid)}>{pending && <Loader2 className="animate-spin" />}Save roles</Button>
        <Button variant="outline" disabled={pending} onClick={() => { setGrid(gridFor(null)); onSave({}); }}>Back to defaults</Button>
      </div>
    </section>
  );
}
