import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/contexts/AuthContext";
import { GoogleAnalytics } from "@/components/GoogleAnalytics";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

// Explicit OpenGraph + Twitter Card metadata so social previews
// (Twitter/X, LinkedIn, iMessage, Slack unfurls, etc.) pull the
// current positioning instead of falling back to a bare title. Kept
// in sync with the landing-page hero — same H1 phrasing, same
// three-use-case framing in the subhead.
//
// Note: social platforms cache OG payloads aggressively (Twitter
// ~7d, LinkedIn ~7d, Facebook until forced). After deploying a
// metadata change, force-refresh via:
//   - LinkedIn: https://www.linkedin.com/post-inspector/
//   - Twitter/X: https://cards-dev.twitter.com/validator (or paste
//     the URL into a draft tweet — the preview re-fetches)
//   - Facebook: https://developers.facebook.com/tools/debug/
const OG_TITLE =
  "granted.bio — Deep topical intelligence on any life-sciences research field"
const OG_DESCRIPTION =
  "Cross-linked synthesis of every NIH-funded project, clinical trial, patent, and publication on your topic. For grant writing, investment diligence, and partnership scouting."

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://www.granted.bio"),
  title: OG_TITLE,
  description: OG_DESCRIPTION,
  openGraph: {
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    url: "/",
    siteName: "granted.bio",
    type: "website",
    images: [
      {
        // Uses the logo asset as a fallback OG image. Not ideal
        // (proper 1200x630 branded card is a follow-up) but better
        // than a URL preview with no image at all.
        url: "/granted_logo.png",
        alt: "granted.bio",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    images: ["/granted_logo.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthProvider>
          {children}
        </AuthProvider>
        <GoogleAnalytics />
      </body>
    </html>
  );
}
