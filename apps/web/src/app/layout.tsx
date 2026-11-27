import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KOL-Index",
  description: "監控台在 /console/。首頁與 /queue 進入隊列分頁。元件健康在 /ops/health。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
