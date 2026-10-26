import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // This folder is the project root, even though a stray lockfile sits in the home folder
  turbopack: { root: path.resolve(import.meta.dirname) },
  // Menu photos come in through a Server Action, already shrunk in the browser to under ~1 MB;
  // as base64 that is about 1.3 MB, over the 1 MB default
  // Hostinger's build box reports ~64 CPUs but caps threads per account; one build worker per CPU
  // ran out of threads ("OS can't spawn worker thread") while collecting page data
  experimental: { serverActions: { bodySizeLimit: "3mb" }, cpus: 2 },
  async headers() {
    return [
      // Global security headers against clickjacking, MIME-sniffing and data leakage
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
        ],
      },
      // HTTPS only, remembered by the browser for a year. Never on localhost: a production build run
      // locally would make the browser force https://localhost, where nothing listens
      ...(process.env.NODE_ENV === "production"
        ? [{
            source: "/(.*)",
            missing: [{ type: "host" as const, value: "(localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0)" }],
            headers: [{ key: "Strict-Transport-Security", value: "max-age=31536000" }],
          }]
        : []),
      // Uploaded menu photos have random names that never change, so phones can keep them
      { source: "/uploads/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      // App icons and the staff app manifest change rarely
      { source: "/staff-icon/:size", headers: [{ key: "Cache-Control", value: "public, max-age=604800" }] },
    ];
  },
};

export default nextConfig;
