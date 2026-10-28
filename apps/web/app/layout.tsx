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
import { SITE_CARD_DESCRIPTION, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL, siteJsonLd } from "@/lib/seo";

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

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_CARD_DESCRIPTION,
    siteName: SITE_NAME,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_CARD_DESCRIPTION,
    ...(X_HANDLE ? { site: X_HANDLE, creator: X_HANDLE } : {}),
  },
};

const JSON_LD = JSON.stringify(siteJsonLd(SITE_DESCRIPTION)).replace(/</g, "\\u003c");

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
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
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
