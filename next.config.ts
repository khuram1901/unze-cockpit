import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse"],
  async redirects() {
    return [
      {
        source: "/executive",
        destination: "/home",
        permanent: true, // 308 — /executive is removed for good
      },
    ];
  },
};

export default nextConfig;
