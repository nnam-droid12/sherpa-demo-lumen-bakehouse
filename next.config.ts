import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: "/catalog.json",
        destination: "/catalog",
      },
    ];
  },
};

export default nextConfig;
