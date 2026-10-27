"use server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "@/server/errors";
import { storeMenuImage } from "@/server/menu-storage";
import { currentStaff } from "@/server/staff/request";

// Anyone signed in to the console (owner, manager, accountant...) sets their own photo here.
// The same photo shows in the team list and the attendance register.

export async function myPhotoAction() {
  const staff = await currentStaff();
  if (!staff?.userId) return null;
  const [me] = await db.select({ photoUrl: s.users.photoUrl }).from(s.users).where(and(eq(s.users.tenantId, staff.tenantId), eq(s.users.id, staff.userId)));
  return me?.photoUrl ?? null;
}

export async function saveMyPhotoAction(form: FormData): Promise<{ ok: true; photoUrl: string } | { ok: false; error: string }> {
  const staff = await currentStaff();
  if (!staff?.userId) return { ok: false, error: "Sign in again to change your photo." };
  const file = form.get("photo");
  if (!(file instanceof File) || !file.size) return { ok: false, error: "Choose a photo." };
  if (!file.type.startsWith("image/") || file.size > 3_000_000) return { ok: false, error: "Use a photo under 3 MB." };
  try {
    const { url } = await storeMenuImage({ tenantId: staff.tenantId, brandId: "staff", bytes: Buffer.from(await file.arrayBuffer()), contentType: file.type, filename: file.name });
    await db.update(s.users).set({ photoUrl: url }).where(and(eq(s.users.tenantId, staff.tenantId), eq(s.users.id, staff.userId)));
    return { ok: true, photoUrl: url };
  } catch (e) {
    return { ok: false, error: e instanceof AppError ? e.message : "Could not save the photo. Try again." };
  }
}
