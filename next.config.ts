import type { NextConfig } from "next";

// Cache Components stays off: every page here depends on the logged-in user
// and on live shift data, so nothing should be prerendered or cached.
const nextConfig: NextConfig = {};

export default nextConfig;
