import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <div className="kicker">KOL-Index · Next.js 宿主</div>
      <h1>靈境 · LINKIN</h1>
      <p>
        前端宿主已改為 Next.js（ADR-008）。十二個分頁仍在原型層，整包掛在
        <code> /console/ </code>
        ，對照行為不變。分頁會一頁一頁遷進 App Router。
      </p>
      <div className="actions">
        <Link className="btn primary" href="/console/index.html">
          打開現用監控台
        </Link>
        <Link className="btn" href="/console/index.html#/health">
          監控台 · 元件健康
        </Link>
        <Link className="btn" href="/ops/health">
          元件健康（SSR）
        </Link>
      </div>
      <section className="card">
        <h2>這一階段的架構</h2>
        <ul>
          <li>
            <b>apps/web</b>：Next.js 殼層、rewrite、之後的 SSR 分頁
          </li>
          <li>
            <b>/console/</b>：由倉庫根目錄同步的 <code>index2.html</code> + <code>js/</code>
          </li>
          <li>
            <b>KOL_BFF（預設 5201）</b>：<code>tests/dev-server.mjs</code> 提供登入、Sherlock、Docker
          </li>
          <li>
            <b>KOL_CONTROL（5220）</b>：人物主檔與圖片索引控制面
          </li>
          <li>
            <b>KOL_API（5210）</b>：既有業務 API（另一個 repo）
          </li>
        </ul>
        <p className="note">
          登入走 <code>/__auth</code>，Next 會轉到 <code>127.0.0.1:5201</code>。開發預設不設通行碼：另開終端跑{" "}
          <code>npm run dev:bff</code>，再到 <code>/console/index.html</code> 任填操作者名稱即可進入（角色為操作者）。
          要測閘門時不要用這個腳本，改直接帶 <code>KOL_GATE</code> 啟動 <code>tests/dev-server.mjs</code>。
        </p>
      </section>
    </main>
  );
}
