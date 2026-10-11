import { ImageResponse } from "next/og";

// App icon for the installed staff app, drawn at the sizes phones ask for. The mark sits inside
// the middle 80% so Android can crop it to any shape (maskable).

const SIZES = new Set([180, 192, 512]);

export function generateStaticParams() {
  return [...SIZES].map((size) => ({ size: String(size) }));
}

export async function GET(_req: Request, ctx: RouteContext<"/staff-icon/[size]">) {
  const size = Number((await ctx.params).size);
  if (!SIZES.has(size)) return new Response("Not found", { status: 404 });
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#1f2937" }}>
        <div
          style={{
            width: size * 0.56,
            height: size * 0.56,
            borderRadius: size * 0.14,
            background: "#c9482b",
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: size * 0.36,
            fontWeight: 800,
          }}
        >
          T
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
