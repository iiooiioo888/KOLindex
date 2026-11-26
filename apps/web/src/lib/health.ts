import net from "node:net";

export type CheckState = "up" | "down" | "unset" | "absent";

export type ComponentCheck = {
  id: string;
  name: string;
  kind?: "probe" | "docker" | string;
  via: "tcp" | "http" | "disk" | "compose" | string;
  state: CheckState;
  content?: string;
  service?: string;
  image?: string;
  bind?: string;
  health?: string;
  container?: string;
  freeBytes?: number;
};

export type ComponentHealthReport = {
  ok: boolean;
  source: "bff" | "local";
  items: ComponentCheck[];
  docker?: {
    enabled?: boolean;
    message?: string;
    total?: number;
    up?: number;
  };
  duration_ms?: number;
  note?: string;
};

function safeHost(value: string | undefined): string {
  return /^[a-zA-Z0-9._-]{1,253}$/.test(value ?? "") ? (value as string) : "";
}

function probeTcp(host: string, port: number): Promise<CheckState> {
  if (!host) return Promise.resolve("unset");
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve("down");
    }, 1500);
    socket.on("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve("up");
    });
    socket.on("error", () => {
      clearTimeout(timer);
      resolve("down");
    });
  });
}

function probeHttp(raw: string): Promise<CheckState> {
  if (!raw) return Promise.resolve("unset");
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return Promise.resolve("unset");
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return Promise.resolve("unset");
  if (target.username || target.password) return Promise.resolve("unset");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  return fetch(target, { signal: ctrl.signal })
    .then((response) => {
      clearTimeout(timer);
      return response.ok ? "up" : "down";
    })
    .catch(() => {
      clearTimeout(timer);
      return "down";
    });
}

async function localProbes(): Promise<ComponentCheck[]> {
  const minio = process.env.MINIO_ENDPOINT?.replace(/\/+$/, "") ?? "";
  const meili = process.env.MEILI_HOST?.replace(/\/+$/, "") ?? "";
  const [postgres, redis, minioState, meiliState] = await Promise.all([
    probeTcp(safeHost(process.env.POSTGRES_HOST), Number(process.env.POSTGRES_PORT || 5432)),
    probeTcp(safeHost(process.env.REDIS_HOST), Number(process.env.REDIS_PORT || 6379)),
    probeHttp(minio ? `${minio}/minio/health/live` : ""),
    probeHttp(meili ? `${meili}/health` : ""),
  ]);
  return [
    { id: "postgres", name: "PostgreSQL", kind: "probe", via: "tcp", state: postgres, content: "需設 POSTGRES_HOST" },
    { id: "redis", name: "Redis", kind: "probe", via: "tcp", state: redis, content: "第一版 Compose 未啟動" },
    { id: "minio", name: "MinIO", kind: "probe", via: "http", state: minioState, content: "第一版 Compose 未啟動" },
    { id: "meilisearch", name: "Meilisearch", kind: "probe", via: "http", state: meiliState, content: "需設 MEILI_HOST" },
  ];
}

async function fetchBffComponents(): Promise<ComponentHealthReport | null> {
  const bff = (process.env.KOL_BFF || "http://127.0.0.1:5201").replace(/\/+$/, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const response = await fetch(`${bff}/__health/components`, {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    clearTimeout(timer);
    if (response.status === 401) {
      return {
        ok: false,
        source: "bff",
        items: [],
        note: "BFF 開了通行碼。請先登入監控台，或在本機開發關掉 KOL_GATE。",
      };
    }
    if (!response.ok) return null;
    const body = (await response.json()) as {
      ok?: boolean;
      items?: ComponentCheck[];
      docker?: ComponentHealthReport["docker"];
      duration_ms?: number;
      source?: string;
    };
    if (!Array.isArray(body.items)) return null;
    return {
      ok: body.ok !== false,
      source: "bff",
      items: body.items,
      docker: body.docker,
      duration_ms: body.duration_ms,
      note: body.source || "GET /__health/components",
    };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/** 優先讀 BFF 完整目錄；BFF 不可用時退回本機四項探測。 */
export async function checkComponentsReport(): Promise<ComponentHealthReport> {
  const fromBff = await fetchBffComponents();
  if (fromBff && fromBff.items.length) return fromBff;
  if (fromBff && fromBff.note) {
    const local = await localProbes();
    return {
      ok: false,
      source: "local",
      items: local,
      note: fromBff.note,
    };
  }
  const local = await localProbes();
  return {
    ok: true,
    source: "local",
    items: local,
    note: "BFF（KOL_BFF）沒回應，只顯示 Next 本機探測。另開終端跑 npm run dev:bff 可看到 Docker 目錄。",
  };
}

/** 相容舊呼叫：只回 items。 */
export async function checkComponents(): Promise<ComponentCheck[]> {
  const report = await checkComponentsReport();
  return report.items;
}

export function readyStatus(items: ComponentCheck[]): number {
  const configured = items.filter((item) => item.state !== "unset" && item.state !== "absent");
  if (!configured.length) return 200;
  return configured.every((item) => item.state === "up") ? 200 : 503;
}
