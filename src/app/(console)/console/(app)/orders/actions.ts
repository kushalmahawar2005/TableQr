"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/server/errors";
import { markServed } from "@/server/kitchen/actions";
import { staffFor } from "@/server/staff/request";

/** Marks a ready order's plates as served from the Orders board */
export async function servedAction(lineIds: string[]): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await markServed(await staffFor(["waiter", "manager", "owner"]), lineIds.map(String).slice(0, 100));
    revalidatePath("/console/orders");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof AppError ? e.message : "Could not mark it served. Try again." };
  }
}
