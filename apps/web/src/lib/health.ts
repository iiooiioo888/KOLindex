import net from "node:net";

export type CheckState = "up" | "down" | "unset";

export type ComponentCheck = {
  id: "postgres" | "redis" | "minio" | "meilisearch";
  name: string;
  via: "tcp" | "http";
  state: CheckState;
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

export async function checkComponents(): Promise<ComponentCheck[]> {
  const minio = process.env.MINIO_ENDPOINT?.replace(/\/+$/, "") ?? "";
  const meili = process.env.MEILI_HOST?.replace(/\/+$/, "") ?? "";
  const [postgres, redis, minioState, meiliState] = await Promise.all([
    probeTcp(safeHost(process.env.POSTGRES_HOST), Number(process.env.POSTGRES_PORT || 5432)),
    probeTcp(safeHost(process.env.REDIS_HOST), Number(process.env.REDIS_PORT || 6379)),
    probeHttp(minio ? `${minio}/minio/health/live` : ""),
    probeHttp(meili ? `${meili}/health` : ""),
  ]);
  return [
    { id: "postgres", name: "PostgreSQL", via: "tcp", state: postgres },
    { id: "redis", name: "Redis", via: "tcp", state: redis },
    { id: "minio", name: "MinIO", via: "http", state: minioState },
    { id: "meilisearch", name: "Meilisearch", via: "http", state: meiliState },
  ];
}

export function readyStatus(items: ComponentCheck[]): number {
  const configured = items.filter((item) => item.state !== "unset");
  if (!configured.length) return 200;
  return configured.every((item) => item.state === "up") ? 200 : 503;
}
