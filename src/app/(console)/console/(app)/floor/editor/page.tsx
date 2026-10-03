import { redirect } from "next/navigation";
import { currentStaff } from "@/server/staff/request";
import { floorEditorRoles, getOrCreateDraft } from "@/server/floor/editor";
import { FloorEditor } from "./_components/floor-editor";

export default async function FloorEditorPage() {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  if (!staff.roles.some((r) => floorEditorRoles.includes(r as never))) return <main className="p-8"><h1 className="font-display text-title font-bold">Permission denied</h1><p className="mt-2 text-muted">Managers and owners can edit the published floor plan.</p></main>;
  const draft = await getOrCreateDraft(staff);
  return <FloorEditor initial={draft} outletName={staff.outlet.name} />;
}
