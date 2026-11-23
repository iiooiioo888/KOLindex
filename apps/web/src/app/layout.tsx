import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "靈境 · Linkin",
  description: "KOL-Index 網頁。伺服器向資料庫、快取、物件儲存與搜尋要健康檢查。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
