import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { WalletProvider } from "@/components/wallet-provider";
import { SmoothScroll, Grain } from "@/components/motion";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://vise.fun"),
  title: {
    default: "VISE — Hold under pressure",
    template: "%s · VISE",
  },
  description:
    "Lock pump.fun coins and earn the trading fees they generate. Longer locks take a larger share. Every trade pays the people who didn't sell.",
  openGraph: {
    title: "VISE — Hold under pressure",
    description:
      "Lock pump.fun coins and earn the trading fees they generate. Longer locks take a larger share.",
    url: "https://vise.fun",
    siteName: "VISE",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "VISE — Hold under pressure",
    description:
      "Lock pump.fun coins and earn the trading fees they generate. Longer locks take a larger share.",
    creator: "@visedotfun",
  },
};

export const viewport: Viewport = {
  themeColor: "#06070a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${geist.variable} ${geistMono.variable}`}
    >
      <body>
        <a href="#content" className="skip-link">
          Skip to content
        </a>
        <WalletProvider>
          <SmoothScroll />
          <Grain />
          <SiteHeader />
          {/*
            The header floats over the page, so every route needs to clear it.
            The hero cancels this with a negative margin to run full-bleed.
          */}
          <main id="content" className="min-h-screen pt-[84px]">
            {children}
          </main>
          <SiteFooter />
        </WalletProvider>
      </body>
    </html>
  );
}
