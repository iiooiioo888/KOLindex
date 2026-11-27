import type { NextConfig } from "next";

const api = (process.env.KOL_API || "http://127.0.0.1:5210").replace(/\/+$/, "");
const control = (process.env.KOL_CONTROL || "http://127.0.0.1:5220").replace(/\/+$/, "");
const bff = (process.env.KOL_BFF || "http://127.0.0.1:5201").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  output: "standalone",
  // README 用 127.0.0.1:5200。dev 預設只放行 localhost，否則客戶端腳本被擋、登入停在「正在問」。
  allowedDevOrigins: ["127.0.0.1"],
  async redirects() {
    return [
      // public/console/index.html 不會自動接到 /console；沒尾斜線會 404
      { source: "/console", destination: "/console/index.html", permanent: false },
      { source: "/console/", destination: "/console/index.html", permanent: false },
    ];
  },
  async rewrites() {
    return [
      // kolindex-api 掛在 /api 下（dev-server 轉發的是完整路徑）。不能把前綴拿掉。
      { source: "/api/:path*", destination: `${api}/api/:path*` },
      { source: "/__control", destination: `${control}/` },
      { source: "/__control/:path*", destination: `${control}/:path*` },
      // 本機 BFF（登入、Sherlock、Docker）仍由 tests/dev-server.mjs 提供，預設 5201
      { source: "/__auth", destination: `${bff}/__auth` },
      { source: "/__auth/:path*", destination: `${bff}/__auth/:path*` },
      { source: "/__sherlock", destination: `${bff}/__sherlock` },
      { source: "/__docker", destination: `${bff}/__docker` },
      { source: "/__docker/:path*", destination: `${bff}/__docker/:path*` },
      { source: "/__oss/:path*", destination: `${bff}/__oss/:path*` },
      { source: "/__health/:path*", destination: `${bff}/__health/:path*` },
      { source: "/__discovery", destination: `${bff}/__discovery` },
      { source: "/__llm", destination: `${bff}/__llm` },
      { source: "/__llm/:path*", destination: `${bff}/__llm/:path*` },
      { source: "/media/:path*", destination: `${bff}/media/:path*` },
    ];
  },
};

export default nextConfig;
