import type { Metadata } from "next";
import { Kalam } from "next/font/google";
import "./globals.css";

// Kalam is the single product typeface. next/font self-hosts the files at build
// time, so there is no runtime request to Google Fonts. Regular (400) + Bold (700).
const kalam = Kalam({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-kalam",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CorkBack",
  description: "A civic board, not a social dashboard. Paper flyers, posted locally.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={kalam.variable}>
      <body className={kalam.className}>{children}</body>
    </html>
  );
}
