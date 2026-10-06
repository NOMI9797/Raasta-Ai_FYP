import type { ReactNode } from "react";
import { Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";
import { getSEOTags } from "@/libs/seo";
import ClientLayout from "@/components/LayoutClient";
import config from "@/config";
import { LenisProvider } from "@/components/providers/LenisProvider";
import { MotionProvider } from "@/components/providers/MotionProvider";
import { PageTransition } from "@/components/providers/PageTransition";
import "./globals.css";

// Body text everywhere
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-sans",
});

// Landing page headings (font-display)
const displayFont = Inter_Tight({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-display",
});

// Mono for data (font-mono)
const monoFont = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata = getSEOTags();

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-theme={config.colors.theme}
      className={`${inter.className} ${inter.variable} ${displayFont.variable} ${monoFont.variable}`}
    >
      <head>
        <meta charSet="utf-8" />
      </head>
      <body>
        <ClientLayout>
          <MotionProvider>
            <LenisProvider>
              <PageTransition>{children}</PageTransition>
            </LenisProvider>
          </MotionProvider>
        </ClientLayout>
      </body>
    </html>
  );
}
