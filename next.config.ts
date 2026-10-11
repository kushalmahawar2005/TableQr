import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      // Uploaded menu photos have random names that never change, so phones can keep them
      { source: "/uploads/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      // App icons and the staff app manifest change rarely
      { source: "/staff-icon/:size", headers: [{ key: "Cache-Control", value: "public, max-age=604800" }] },
    ];
  },
};

export default nextConfig;
