import type { NextConfig } from "next";

/**
 * Content-Security-Policy. The site shows creator-chosen coin metadata and,
 * for signed-in accounts, can reveal a wallet's secret key, so the policy's
 * job is containment: no script from anywhere but this origin, no network
 * request to anywhere but the API and the RPC, no image from a host we do not
 * pin metadata to. Inline scripts stay allowed because the App Router
 * hydrates through them on statically prerendered pages; exfiltration is
 * what connect-src/img-src/form-action close off.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";
const RPC_WS = RPC.replace(/^http/, "ws");
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://pump.mypinata.cloud https://*.pinata.cloud https://ipfs.io https://*.arweave.net https://lh3.googleusercontent.com",
  "media-src 'self'",
  "font-src 'self' data:",
  `connect-src 'self' ${API} ${RPC} ${RPC_WS}`,
  `form-action 'self' ${API}`,
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  // Only where the API is https: the local rig talks to http://localhost.
  ...(API.startsWith("https:") ? ["upgrade-insecure-requests"] : []),
].join("; ");

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@imagine/sdk"],
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "ipfs.io" },
      { protocol: "https", hostname: "**.pinata.cloud" },
      { protocol: "https", hostname: "pump.mypinata.cloud" },
      { protocol: "https", hostname: "**.arweave.net" },
    ],
  },
  async redirects() {
    // The Railway hostname keeps working as an origin but is not a site:
    // sessions are same-site with api.vise.fun only under vise.fun.
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "web-production-3100c.up.railway.app" }],
        destination: "https://vise.fun/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.vise.fun" }],
        destination: "https://vise.fun/:path*",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default config;
