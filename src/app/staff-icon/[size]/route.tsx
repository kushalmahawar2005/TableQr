import { ImageResponse } from "next/og";
import { staffAppBrandForOutletCode } from "@/server/staff/pwa-branding";

// App icon for the installed staff app, drawn at the sizes phones ask for. The mark sits inside
// the middle 80% so Android can crop it to any shape (maskable).

const SIZES = new Set([180, 192, 512]);
export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return [...SIZES].map((size) => ({ size: String(size) }));
}

export async function GET(req: Request, ctx: RouteContext<"/staff-icon/[size]">) {
  const size = Number((await ctx.params).size);
  if (!SIZES.has(size)) return new Response("Not found", { status: 404 });
  const brand = await staffAppBrandForOutletCode(new URL(req.url).searchParams.get("outlet"));
  const accent = /^#[\da-f]{6}$/i.test(brand?.accentColor ?? "") ? brand!.accentColor! : "#c9482b";
  const initial = brand?.name.trim().slice(0, 1).toLocaleUpperCase() || "T";
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#f3f1ec" }}>
        <div
          style={{
            width: size * 0.72,
            height: size * 0.72,
            borderRadius: size * 0.2,
            background: accent,
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: size * 0.4,
            fontWeight: 800,
          }}
        >
          {initial}
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
