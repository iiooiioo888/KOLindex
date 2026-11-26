import { checkComponentsReport, type CheckState } from "@/lib/health";
import Link from "next/link";

export const dynamic = "force-dynamic";

const label: Record<CheckState, string> = {
  up: "有回應",
  down: "沒回應",
  unset: "未設定／監測關",
  absent: "不在",
};

function shortImage(image?: string): string {
  const s = String(image || "");
  if (!s) return "—";
  if (s.includes("@sha256:")) {
    const [name, dig] = s.split("@sha256:");
    return `${name.split("/").pop()}@${dig.slice(0, 12)}`;
  }
  return s.length > 48 ? `${s.slice(0, 47)}…` : s;
}

export default async function OpsHealthPage() {
  const report = await checkComponentsReport();
  const probes = report.items.filter((item) => item.kind !== "docker");
  const dockers = report.items.filter((item) => item.kind === "docker");
  const known = report.items.filter((item) => item.state === "up" || item.state === "down");
  const up = known.filter((item) => item.state === "up").length;

  return (
    <main>
      <div className="kicker">SSR · /ops/health</div>
      <h1>元件健康</h1>
      <p>
        伺服器詢問資料服務與 Compose 目錄。瀏覽器不直連容器埠。來源：
        <code>{report.source === "bff" ? "BFF /__health/components" : "Next 本機探測"}</code>
        {report.duration_ms != null ? ` · ${report.duration_ms} ms` : ""}
        {known.length ? ` · 探測 ${up}/${known.length}` : ""}
      </p>
      <div className="actions">
        <Link className="btn primary" href="/console/index.html#/health">
          監控台 · 元件健康
        </Link>
        <Link className="btn" href="/console/index.html#/infra/docker">
          基礎設施／服務
        </Link>
        <Link className="btn" href="/">
          回殼層
        </Link>
      </div>

      {report.note ? <p className="note">{report.note}</p> : null}

      <section className="card">
        <h2>探測項</h2>
        <table>
          <thead>
            <tr>
              <th>元件</th>
              <th>問法</th>
              <th>狀態</th>
              <th>內容</th>
            </tr>
          </thead>
          <tbody>
            {probes.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.via === "http" ? "HTTP" : item.via === "disk" ? "磁碟" : "TCP"}</td>
                <td className={item.state}>{label[item.state] || item.state}</td>
                <td className="mono">{item.content || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>
          Docker Compose 目錄
          {report.docker
            ? ` · ${report.docker.enabled ? "監測開" : "監測關"} · ${report.docker.up ?? 0}/${report.docker.total ?? dockers.length}`
            : ""}
        </h2>
        {report.docker?.message ? <p className="note">{report.docker.message}</p> : null}
        {!dockers.length ? (
          <p className="note">
            還沒有容器目錄。確認 BFF 在跑（預設 5201），並視需要設 <code>KOL_DOCKER=1</code>。
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>服務</th>
                <th>狀態</th>
                <th>健康</th>
                <th>埠</th>
                <th>映像／內容</th>
              </tr>
            </thead>
            <tbody>
              {dockers.map((item) => (
                <tr key={item.id}>
                  <td className="mono">{item.service || item.name}</td>
                  <td className={item.state}>{label[item.state] || item.state}</td>
                  <td>{item.health || "—"}</td>
                  <td className="mono">{item.bind || "—"}</td>
                  <td>
                    <div className="mono">{shortImage(item.image)}</div>
                    <div className="note">{item.content || "—"}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
