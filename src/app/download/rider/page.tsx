import type { Metadata } from "next";
import { latestRelease } from "@/server/admin/app-releases";

export const metadata: Metadata = { title: "Download TableQR Rider", description: "The delivery rider app for restaurants on TableQR." };
export const dynamic = "force-dynamic";

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

// The rider app's public download page: always the newest version the admin uploaded
export default async function RiderDownloadPage() {
  const app = await latestRelease("rider");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10 text-ink">
      <section className="rounded-[28px] border border-line/60 bg-surface p-6 text-center shadow-[0_18px_50px_-20px_rgb(31_41_55/0.28)]">
        <span aria-hidden className="mx-auto grid size-20 place-items-center rounded-[22px] bg-[#c9482b] text-4xl shadow-lg">🛵</span>
        <h1 className="mt-4 font-display text-[1.75rem] leading-tight font-bold">TableQR Rider</h1>
        <p className="mt-1 text-body text-muted">For delivery riders of restaurants on TableQR</p>
        {app ? (
          <>
            <a href={app.url} className="mt-6 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#c9482b] px-4 text-button font-bold text-white shadow-[0_10px_24px_-8px_rgb(201_72_43/0.6)]">⬇ Download for Android</a>
            <p className="mt-2 text-caption text-muted">Version {app.version} · {mb(app.sizeBytes)}</p>
            {app.notes && <p className="mt-1 text-caption text-muted">{app.notes}</p>}
          </>
        ) : <p className="mt-6 rounded-2xl bg-paper p-4 text-body text-muted">The app is not available yet. Check back soon.</p>}
      </section>
      <ol className="mt-5 grid gap-2 text-caption text-muted">
        <li><b className="text-ink">1.</b> Tap Download, then open the file. If asked, allow installing apps from this source.</li>
        <li><b className="text-ink">2.</b> Sign in with the phone number and PIN your restaurant gave you.</li>
        <li><b className="text-ink">3.</b> Go online and allow location “all the time”, so customers can track you with the screen off.</li>
        <li><b className="text-ink">4.</b> On Xiaomi, Oppo or Vivo phones: Settings → Battery → TableQR Rider → No restrictions.</li>
      </ol>
    </main>
  );
}
