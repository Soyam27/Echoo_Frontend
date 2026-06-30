import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "https://echoo-1-7ldp.onrender.com/:path*",
      },
    ];
  },
};

export default nextConfig;
