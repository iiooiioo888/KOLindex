import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "靈境 · LINKIN",
  description: "KOL-Index Next.js 宿主。現用監控台在 /console/，元件健康在 /ops/health。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
