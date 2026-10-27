"use server";
import type { RoomStatus } from "@/domain/rooms";
import { AppError } from "@/server/errors";
import { assignRoomWaiter, checkIn, checkOut, finishRoomRequest, getRooms, removeRoom, roomFoodTab, saveRoom, setRoomStatus, stayHistory } from "@/server/staff/rooms";
import { staffFor } from "@/server/staff/request";

const ROLES = ["owner", "manager", "reception"] as const;

async function run<T>(work: (staff: Awaited<ReturnType<typeof staffFor>>) => Promise<T>) {
  try {
    return { ok: true as const, data: await work(await staffFor(ROLES, "rooms")) };
  } catch (e) {
    return { ok: false as const, error: e instanceof AppError ? e.message : "Could not save. Try again." };
  }
}
export async function roomsAction() { return run(async (s) => ({ rooms: await getRooms(s), history: await stayHistory(s) })); }
export async function saveRoomAction(input: Parameters<typeof saveRoom>[1]) { return run((s) => saveRoom(s, input)); }
export async function removeRoomAction(id: string) { return run((s) => removeRoom(s, id)); }
export async function roomStatusAction(id: string, status: RoomStatus) { return run((s) => setRoomStatus(s, id, status)); }
export async function checkInAction(id: string, input: Parameters<typeof checkIn>[2]) { return run((s) => checkIn(s, id, input)); }
export async function checkOutAction(id: string) { return run((s) => checkOut(s, id)); }
export async function foodTabAction(id: string) { return run((s) => roomFoodTab(s, id)); }
export async function requestDoneAction(id: string) { return run((s) => finishRoomRequest(s, id)); }
export async function roomWaiterAction(id: string, waiterId: string | null) { return run((s) => assignRoomWaiter(s, String(id), waiterId ? String(waiterId) : null)); }
