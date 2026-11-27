/**
 * 用 js/index2.js 裡的舊函式跑同一份夾具，比對車道計數與卡片欄位。
 * 不一致就退出 1，呼叫端不該把 / 換成新隊列。
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..");
const indexSrc = readFileSync(join(repo, "js", "index2.js"), "utf8");
const boardSrc = readFileSync(join(here, "..", "src", "lib", "queue-board.ts"), "utf8");

function extractFunction(src, name) {
  const needle = "function " + name + "(";
  const start = src.indexOf(needle);
  if (start < 0) throw new Error("找不到 " + name);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error("括號沒閉合 " + name);
}

const names = ["boardLane", "mergeSeatAgentBoard", "mergeMylikeIntelBoard", "tallyBoard", "buildBoard"];
const oldScript =
  names.map((name) => extractFunction(indexSrc, name)).join("\n") +
  `
function seatAgentBoardItems(){ return current.seatAgentItems || []; }
function discoverItems(){ return current.discoverItems || []; }
function runOld(){
  var items = mergeMylikeIntelBoard(mergeSeatAgentBoard(buildBoard(
    current.jobs, current.reviews, current.mylike, current.download, current.seats
  )));
  return { items: items, lanes: tallyBoard(items) };
}
`;

const sandbox = {
  current: {},
  window: {},
};
sandbox.window.KOLINDEX_MYLIKE_INTEL = {
  boardItems() {
    return sandbox.current.mylikeIntelItems || [];
  },
};
vm.createContext(sandbox);
vm.runInContext(oldScript, sandbox);

const compiled = ts.transpileModule(boardSrc, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const outDir = mkdtempSync(join(tmpdir(), "kol-queue-"));
const outFile = join(outDir, "queue-board.mjs");
writeFileSync(outFile, compiled);
const mod = await import(pathToFileURL(outFile).href);

function signature(items) {
  return (items || [])
    .map((item) => [item.board, item.state, item.ref, item.title, item.detail, item.error || ""].join("|"))
    .join("\n");
}

function lanesText(lanes) {
  return ["queue", "wait", "proc", "split", "gen"].map((key) => key + "=" + lanes[key]).join(",");
}

const cases = [
  {
    name: "排程狀態進五條車道",
    jobs: {
      counts: { succeeded: 3, failed: 1 },
      items: [
        { id: 1, state: "queued", job_type: "sync", handle: "ada", connector: "douyin" },
        { id: 2, state: "backoff", job_type: "sync", platform: "douyin", connector: "douyin" },
        { id: 3, state: "running", job_type: "backfill", error_code: "429" },
        { id: 4, state: "failed", job_type: "sync", error_code: "schema" },
        { id: 5, state: "succeeded", job_type: "sync" },
        { id: 6, state: "claimed", job_type: "sync" },
      ],
    },
    reviews: { items: [], counts: { open: 0 } },
    mylike: { job: { state: "idle" } },
    download: { job: { state: "idle" } },
    seats: { seats: [], tasks: [{ id: 9, status: "running", seat: "s1", label: "掃庫" }] },
  },
  {
    name: "歸戶只留 identity 的 open 與 deferred",
    jobs: { counts: {}, items: [] },
    reviews: {
      counts: { open: 1 },
      items: [
        { id: 7, kind: "identity", state: "open", subject: "甲", kind_label: "歸戶", score: 0.8 },
        { id: 8, kind: "identity", state: "deferred", subject: "乙" },
        { id: 9, kind: "identity", state: "rejected", subject: "丙" },
        { id: 10, kind: "relation", state: "open", subject: "丁" },
      ],
    },
    mylike: null,
    download: null,
    seats: null,
  },
  {
    name: "MyLike 與缺檔下載只在進行中進看板",
    jobs: { counts: { succeeded: 0, failed: 0 }, items: [] },
    reviews: { items: [] },
    mylike: { job: { state: "running", targetName: "收藏", pages: 2, added: 4 } },
    download: { job: { state: "running", done: 3, total: 9 } },
    seats: { auto: true, tickMs: 1500, avgMs: 2500, seats: [{ id: "A", state: "running", current: { id: 1, label: "掃" }, lane: "library", done: 2, failed: 0 }], tasks: [] },
  },
  {
    name: "席位 Agent 只出現一次，MyLike 分析接在後面",
    jobs: { counts: {}, items: [{ id: 1, state: "queued", job_type: "sync" }] },
    reviews: { items: [] },
    mylike: null,
    download: null,
    seats: { tasks: [{ id: 3, status: "queued", seat: "s2", kind: "audit" }] },
    seatAgentItems: [{ board: "agent-job", state: "running", ref: "J-1", title: "大任務", detail: "拆分", error: "", source: "seat-agent" }],
    mylikeIntelItems: [{ board: "mylike-intel", state: "queued", ref: "MLI-1", title: "缺口", detail: "缺檔", error: "" }],
    discoverItems: [{ board: "discover", state: "queued", ref: "D-1", title: "ada", detail: "已記入待查", error: "" }],
  },
];

let failed = 0;
for (const sample of cases) {
  sandbox.current = {
    jobs: sample.jobs,
    reviews: sample.reviews,
    mylike: sample.mylike,
    download: sample.download,
    seats: sample.seats,
    seatAgentItems: sample.seatAgentItems || [],
    mylikeIntelItems: sample.mylikeIntelItems || [],
    discoverItems: sample.discoverItems || [],
  };
  const oldResult = sandbox.runOld();
  const neu = mod.assembleBoard({
    jobs: sample.jobs,
    reviews: sample.reviews,
    mylike: sample.mylike,
    download: sample.download,
    seats: sample.seats,
    seatAgentItems: sample.seatAgentItems || [],
    mylikeIntelItems: sample.mylikeIntelItems || [],
    discoverItems: sample.discoverItems || [],
  });
  const oldSig = signature(oldResult.items);
  const newSig = signature(neu.items);
  const oldLanes = lanesText(oldResult.lanes);
  const newLanes = lanesText(neu.lanes);
  if (oldSig !== newSig || oldLanes !== newLanes) {
    failed += 1;
    console.error("不一致：" + sample.name);
    console.error("舊車道 " + oldLanes);
    console.error("新車道 " + newLanes);
    console.error("舊卡片\n" + oldSig);
    console.error("新卡片\n" + newSig);
  } else {
    console.log("一致 " + sample.name + " · " + oldLanes);
  }
}

const sanity = mod.assembleBoard({
  jobs: { items: [{ id: 1, state: "queued", job_type: "sync" }], counts: {} },
  reviews: { items: [] },
  mylike: null,
  download: null,
  seats: { tasks: [{ id: 9, status: "running", seat: "s1", label: "掃庫" }] },
});
if (sanity.lanes.queue !== 1 || sanity.lanes.proc !== 0) {
  console.error("健全檢查失敗：佇列應為 1，席位工單不進執行車道");
  failed += 1;
}

const missing = mod.deriveQueue({
  jobs: null,
  seats: null,
  rail: null,
  reviews: null,
  mylike: null,
  download: null,
  llm: null,
});
if (missing !== null) {
  console.error("沒有 jobs.counts 也沒有 reviews.items 時不該造出看板");
  failed += 1;
}

const partial = mod.deriveQueue(
  {
    jobs: { counts: {}, items: [] },
    seats: null,
    rail: null,
    reviews: { items: [], counts: {} },
    mylike: null,
    download: null,
    llm: null,
  },
  Date.parse("2026-11-27T06:00:00Z"),
);
if (!partial || partial.metrics.claimRate !== null || partial.metrics.slotUsed !== null || partial.metrics.slotWait !== null) {
  console.error("缺席位與 rail 時，認領、忙線、耗時應是 null");
  failed += 1;
} else if (partial.metrics.queueDepth !== 0) {
  console.error("有空的 jobs 時，佇列深度應是 0 而不是 null");
  failed += 1;
} else {
  console.log("一致 缺來源顯示空值，有回應的車道是 0");
}

if (failed) {
  console.error("隊列對照失敗 " + failed + " 項");
  process.exit(1);
}
console.log("隊列對照通過");
