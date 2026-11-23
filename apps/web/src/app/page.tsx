import { checkComponents, type CheckState } from "@/lib/health";

export const dynamic = "force-dynamic";

const label: Record<CheckState, string> = {
  up: "有回應",
  down: "沒回應",
  unset: "未設定",
};

const detail: Record<string, string> = {
  "tcp:up": "連接埠有回應",
  "http:up": "健康檢查通過",
  "tcp:down": "—",
  "http:down": "—",
  "tcp:unset": "—",
  "http:unset": "—",
};

export default async function HomePage() {
  const items = await checkComponents();
  return (
    <main>
      <div className="kicker">KOL-Index · Next.js</div>
      <h1>元件健康</h1>
      <p>這一頁在伺服器上詢問 PostgreSQL、Redis、MinIO 與 Meilisearch。瀏覽器不直接連這些服務。</p>
      <table>
        <thead>
          <tr>
            <th>元件</th>
            <th>問法</th>
            <th>狀態</th>
            <th>讀到</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.name}</td>
              <td>{item.via === "http" ? "HTTP 健康檢查" : "TCP"}</td>
              <td className={item.state}>{label[item.state]}</td>
              <td>{detail[`${item.via}:${item.state}`]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
