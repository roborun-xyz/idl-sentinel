import type { Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Analytics } from "@vercel/analytics/next";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jetbrains-mono",
});

const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
const metadataBase = appUrl && /^https?:\/\//i.test(appUrl) ? new URL(appUrl) : undefined;
const description =
  "Change alerts for the Solana programs you depend on: IDL diffs, redeploys, upgrade-authority handoffs, Squads upgrade proposals, and verified-build checks, delivered to Slack, Discord, Telegram, PagerDuty, or a signed webhook.";

export const metadata: Metadata = {
  metadataBase,
  title: {
    default: "IDL Sentinel",
    template: "%s · IDL Sentinel",
  },
  description,
  applicationName: "IDL Sentinel",
  keywords: ["Solana", "IDL", "Anchor", "program monitoring", "interface changes", "alerts"],
  openGraph: {
    type: "website",
    siteName: "IDL Sentinel",
    title: "IDL Sentinel",
    description,
  },
  twitter: {
    card: "summary_large_image",
    title: "IDL Sentinel",
    description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
