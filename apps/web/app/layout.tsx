import type { Metadata, Viewport } from "next";
import { Geist_Mono, Sora } from "next/font/google";
import "./globals.css";
import { MobileNav, SiteHeader } from "@/components/site-header";
import { X_HANDLE } from "@/components/site-header-links";
import { ClusterNotice } from "@/components/cluster-notice";
import { SiteFooter } from "@/components/site-footer";
import { WalletProvider } from "@/components/wallet-provider";
import { AccountProvider } from "@/components/account-provider";
import { SmoothScroll } from "@/components/motion";

const sora = Sora({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-sora",
  display: "swap",
});
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

const TITLE = "IMAGINE — Imagine everyone locks";
const DESCRIPTION =
  "Launch a coin on Raydium, paired with anything. Every trade pays the holders who lock it — in whatever it's paired with. Lock longer, earn a bigger cut.";

export const metadata: Metadata = {
  metadataBase: new URL("https://imagine.fun"),
  title: {
    default: TITLE,
    template: "%s · IMAGINE",
  },
  description: DESCRIPTION,
  applicationName: "IMAGINE",
  openGraph: {
    title: TITLE,
    description: "Lock the meme. Earn its pair. Lock-to-earn vaults for coins launched on Raydium LaunchLab.",
    url: "https://imagine.fun",
    siteName: "IMAGINE",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: "Lock the meme. Earn its pair. Lock-to-earn vaults for coins launched on Raydium LaunchLab.",
    ...(X_HANDLE ? { site: X_HANDLE, creator: X_HANDLE } : {}),
  },
};

export const viewport: Viewport = {
  themeColor: "#071013",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sora.variable} ${geistMono.variable}`}>
      <body>
        <a href="#content" className="skip-link">
          Skip to content
        </a>
        <WalletProvider>
          <AccountProvider>
            <SmoothScroll />
            <SiteHeader />
            <main id="content" className="min-h-[70vh]">
              {children}
            </main>
            <ClusterNotice />
            <SiteFooter />
            <MobileNav />
          </AccountProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
