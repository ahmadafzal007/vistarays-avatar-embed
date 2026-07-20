import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This site is built to be embedded in an <iframe> (e.g. on Wix), so it must
  // explicitly allow being framed by any origin.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors *;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
