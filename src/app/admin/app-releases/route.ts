import { addRelease, appReleases } from "@/server/admin/app-releases";
import { currentPlatformAdmin } from "@/server/admin/auth";
import { AppError } from "@/server/errors";

// Platform admin uploads a new rider app version. A route, not a server action, so a large APK
// is not held back by the server action size limit.
export async function POST(request: Request) {
  if (!(await currentPlatformAdmin())) return Response.json({ ok: false, error: "Sign in again." }, { status: 401 });
  try {
    const form = await request.formData();
    const file = form.get("apk");
    if (!(file instanceof File)) throw new AppError("invalid_state", "Choose the .apk file.");
    await addRelease({ app: "rider", version: String(form.get("version") ?? ""), notes: String(form.get("notes") ?? ""), bytes: Buffer.from(await file.arrayBuffer()) });
    return Response.json({ ok: true, releases: await appReleases("rider") });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof AppError ? e.message : "Upload failed. Try again." }, { status: 400 });
  }
}
