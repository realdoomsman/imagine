import type { NextConfig } from "next";

/**
 * Content-Security-Policy. The site shows creator-chosen coin metadata and,
 * for signed-in accounts, can reveal a wallet's secret key, so the policy's
 * job is containment: no script from anywhere but this origin and no network
 * request to anywhere but the API and the RPC. Images may come from any https
 * host: coin art lives wherever its creator pinned it and StonkFun pair logos
 * span dozens of issuer CDNs, and an image cannot run code. Inline scripts
 * stay allowed because the App Router hydrates through them; `'unsafe-eval'`
 * is added in development only, where React's dev runtime needs it.
 */
const DEV = process.env.NODE_ENV === "development";
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8899";
const RPC_WS = RPC.replace(/^http/, "ws");

const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${DEV ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https: ${API}`,
  "media-src 'self'",
  "font-src 'self' data:",
  `connect-src 'self' ${API} ${RPC} ${RPC_WS}${DEV ? " ws://localhost:* ws://127.0.0.1:*" : ""}`,
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
      { protocol: "https", hostname: "www.stonkfun.xyz" },
      { protocol: "https", hostname: "stonkfun.xyz" },
      { protocol: "https", hostname: "ipfs.io" },
      { protocol: "https", hostname: "**.ipfs.io" },
      { protocol: "https", hostname: "**.pinata.cloud" },
      { protocol: "https", hostname: "**.mypinata.cloud" },
      { protocol: "https", hostname: "arweave.net" },
      { protocol: "https", hostname: "**.arweave.net" },
      { protocol: "https", hostname: "gateway.irys.xyz" },
    ],
  },
  async redirects() {
    // One canonical host: sessions are same-site with api.imagine.fun only
    // under imagine.fun.
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.imagine.fun" }],
        destination: "https://imagine.fun/:path*",
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
          ...(DEV ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
        ],
      },
    ];
  },
};

export default config;
