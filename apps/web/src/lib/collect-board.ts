/**
 * 任務收集對照。規則對齊 js/index2.js 的 mapCollectRecords：
 * claimed → queued（已入列），returned → skip（已略過）。
 * 認領只改這筆的分派狀態，不建立人物、不改 identity_state。
 */

export const COLLECT_PATH = "/api/collect";

export const COLLECT_ROLES = ["分析席", "審核席", "報告席", "工業席"] as const;

export const COLLECT_SOURCES = [
  { id: "xhs", cat: "小紅書採集", name: "XHS-Downloader", license: "GPL-3.0" },
  { id: "douyin-api", cat: "抖音／TikTok／B站", name: "Douyin_TikTok_Download_API", license: "Apache-2.0" },
  { id: "douyin-dl", cat: "抖音（個人輕量）", name: "douyin-dl", license: "Apache-2.0" },
  { id: "maigret", cat: "帳號發現／OSINT", name: "Maigret", license: "MIT" },
  { id: "sherlock", cat: "帳號發現／OSINT", name: "Sherlock", license: "MIT" },
] as const;

const STATE_MAP: Record<string, string> = {
  inbox: "inbox",
  claimed: "queued",
  returned: "skip",
};

export type SourceInfo = {
  name: string;
  cat: string;
  license: string;
};

export type CollectItem = {
  id: string;
  accountId: number | null;
  title: string;
  source: string;
  pri: string;
  priLabel: string;
  role: string;
  state: string;
  note: string;
  taskId: string;
  decidedBy: string;
  local?: boolean;
};

export type CollectFilter = "inbox" | "queued" | "skip" | "all";

export type CollectView = {
  ok: true;
  at: string;
  items: CollectItem[];
  sources: Record<string, SourceInfo>;
};

type RawRecord = {
  id?: unknown;
  accountId?: unknown;
  title?: unknown;
  source?: unknown;
  pri?: unknown;
  priLabel?: unknown;
  role?: unknown;
  state?: unknown;
  note?: unknown;
  taskId?: unknown;
  decidedBy?: unknown;
  srcName?: unknown;
  srcCat?: unknown;
  srcLicense?: unknown;
};

export function mapCollectRecords(items: unknown): { items: CollectItem[]; sources: Record<string, SourceInfo> } {
  const sources: Record<string, SourceInfo> = {};
  const list = Array.isArray(items) ? items : [];
  const mapped = list.map((row) => {
    const item = (row || {}) as RawRecord;
    if (item.srcName) {
      sources[String(item.source)] = {
        name: String(item.srcName),
        cat: String(item.srcCat || "—"),
        license: String(item.srcLicense || "—"),
      };
    }
    const stateKey = item.state == null ? "" : String(item.state);
    return {
      id: String(item.id),
      accountId: item.accountId ? Number(item.accountId) : null,
      title: String(item.title || ""),
      source: String(item.source || "manual"),
      pri: String(item.pri || "p2"),
      priLabel: String(item.priLabel || "P2"),
      role: String(item.role || "審核席"),
      state: String(STATE_MAP[stateKey] || item.state || "inbox"),
      note: String(item.note || ""),
      taskId: String(item.taskId || ""),
      decidedBy: String(item.decidedBy || ""),
    };
  });
  return { items: mapped, sources };
}

export function collectCounts(items: CollectItem[]): { inbox: number; queued: number; skip: number; all: number } {
  const counts = { inbox: 0, queued: 0, skip: 0, all: items.length };
  for (const item of items) {
    if (item.state === "inbox" || item.state === "queued" || item.state === "skip") counts[item.state] += 1;
  }
  return counts;
}

export function sourceOf(id: string, sources: Record<string, SourceInfo>): SourceInfo {
  const known = sources[id];
  if (known) return known;
  if (id === "manual") return { name: "手動收集", cat: "本頁", license: "—" };
  const acq = COLLECT_SOURCES.find((row) => row.id === id);
  if (acq) return { name: acq.name, cat: acq.cat, license: acq.license };
  return { name: id || "—", cat: "—", license: "—" };
}

export function deriveCollect(body: unknown, started: number): CollectView | null {
  if (!body || typeof body !== "object" || !Array.isArray((body as { items?: unknown }).items)) return null;
  const mapped = mapCollectRecords((body as { items: unknown[] }).items);
  return {
    ok: true,
    at: new Date(started).toISOString(),
    items: mapped.items,
    sources: mapped.sources,
  };
}

export function validDiscoverName(raw: string): string | null {
  const name = String(raw || "").trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9._-]{2,32}$/.test(name)) return null;
  return name;
}

export function draftCollectItem(fields: { title: string; pri: string; role: string; source: string }, seq: number): CollectItem | null {
  const title = fields.title.trim();
  if (!title) return null;
  const pri = fields.pri === "p0" || fields.pri === "p2" ? fields.pri : "p1";
  const role = (COLLECT_ROLES as readonly string[]).includes(fields.role) ? fields.role : "分析席";
  const known = fields.source === "manual" || COLLECT_SOURCES.some((row) => row.id === fields.source);
  return {
    id: "C-" + seq,
    accountId: null,
    title,
    source: known ? fields.source : "manual",
    pri,
    priLabel: pri.toUpperCase(),
    role,
    state: "inbox",
    note: "本頁新增。只留在這個瀏覽器，不寫入收集表，也不進 /queue。",
    taskId: "",
    decidedBy: "",
    local: true,
  };
}
