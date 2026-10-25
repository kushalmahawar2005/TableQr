"use server";
import { staffFor } from "@/server/staff/request";
import { AppError } from "@/server/errors";
import { addDraftTable, addDraftZone, deleteDraftTable, getOrCreateDraft, publishDraft, revokeOrReissueQr, setCombination, updateDraftTable, updateDraftZone, floorEditorRoles } from "@/server/floor/editor";

async function run<T>(work: (staff: Awaited<ReturnType<typeof staffFor>>) => Promise<T>) {
  try { return { ok: true as const, data: await work(await staffFor(floorEditorRoles, "floor")) }; }
  catch (e) { return { ok: false as const, error: e instanceof AppError ? e.message : "Could not save the floor plan.", code: e instanceof AppError ? e.code : "unknown", reason: e instanceof AppError ? (e.details?.reason as string | undefined) : undefined }; }
}
export async function draftAction() { return run(getOrCreateDraft); }
export async function updateTableAction(versionId: string, id: string, patch: Parameters<typeof updateDraftTable>[3], revision: number) { return run((s) => updateDraftTable(s, versionId, id, patch, revision)); }
export async function addTableAction(versionId: string, input: Parameters<typeof addDraftTable>[2], revision: number) { return run((s) => addDraftTable(s, versionId, input, revision)); }
export async function addZoneAction(versionId: string, name: string, revision: number) { return run((s) => addDraftZone(s, versionId, name, revision)); }
export async function updateZoneAction(versionId: string, id: string, patch: Parameters<typeof updateDraftZone>[3], revision: number) { return run((s) => updateDraftZone(s, versionId, id, patch, revision)); }
export async function combineAction(versionId: string, tableId: string, otherId: string, enabled: boolean, revision: number) { return run((s) => setCombination(s, versionId, tableId, otherId, enabled, revision)); }
export async function deleteTableAction(versionId: string, tableId: string, revision: number) { return run((s) => deleteDraftTable(s, versionId, tableId, revision)); }
export async function publishAction(versionId: string, revision: number) { return run((s) => publishDraft(s, versionId, revision)); }
export async function qrAction(tableId: string, reissue: boolean) { return run((s) => revokeOrReissueQr(s, tableId, reissue)); }
