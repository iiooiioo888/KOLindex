"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  COLLECT_PATH,
  COLLECT_ROLES,
  COLLECT_SOURCES,
  collectCounts,
  deriveCollect,
  draftCollectItem,
  sourceOf,
  validDiscoverName,
  type CollectFilter,
  type CollectItem,
  type CollectView,
} from "@/lib/collect-board";
import { useWorkbench } from "../frame";

const API_CACHE = "kolindex.collect.api.v1";
const LOCAL_KEY = "kolindex.collect.local.v1";
const CACHE_MAX_MS = 6 * 60 * 60 * 1000;
const POLL_MS = 60000;
const RETRY_MS = 8000;

type LocalBag = { seq: number; items: CollectItem[] };

const FILTERS: { id: CollectFilter; label: string }[] = [
  { id: "inbox", label: "待收" },
  { id: "queued", label: "已入列" },
  { id: "skip", label: "已略過" },
  { id: "all", label: "全部" },
];

function readApiCache(): CollectView | null {
  try {
    const raw = sessionStorage.getItem(API_CACHE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: number; view?: CollectView };
    if (!parsed?.at || !parsed.view || Date.now() - parsed.at > CACHE_MAX_MS) return null;
    return parsed.view;
  } catch {
    return null;
  }
}

function writeApiCache(view: CollectView) {
  try {
    sessionStorage.setItem(API_CACHE, JSON.stringify({ at: Date.now(), view }));
  } catch {
    /* 私密模式或容量不足時忽略 */
  }
}

function readLocal(): LocalBag {
  try {
    const raw = sessionStorage.getItem(LOCAL_KEY);
    if (!raw) return { seq: 107, items: [] };
    const parsed = JSON.parse(raw) as LocalBag;
    if (!parsed || !Array.isArray(parsed.items)) return { seq: 107, items: [] };
    return { seq: Number(parsed.seq) || 107, items: parsed.items };
  } catch {
    return { seq: 107, items: [] };
  }
}

function writeLocal(bag: LocalBag) {
  try {
    sessionStorage.setItem(LOCAL_KEY, JSON.stringify(bag));
  } catch {
    /* 私密模式或容量不足時忽略 */
  }
}

function mergeItems(apiItems: CollectItem[], localItems: CollectItem[]): CollectItem[] {
  const seen = new Set(apiItems.map((item) => item.id));
  return apiItems.concat(localItems.filter((item) => !seen.has(item.id)));
}

export function CollectBoard({ initial, initialMs }: { initial: CollectView | null; initialMs: number | null }) {
  const { setStatus, requireLogin, operator, canWrite, canOperate } = useWorkbench();
  const [view, setView] = useState<CollectView | null>(initial);
  const [local, setLocal] = useState<LocalBag>({ seq: 107, items: [] });
  const [ready, setReady] = useState(false);
  const [filter, setFilter] = useState<CollectFilter>("inbox");
  const [link, setLink] = useState<"live" | "cache" | "down">(initial ? "live" : "down");
  const [ms, setMs] = useState<number | null>(initial ? initialMs : null);
  const [banner, setBanner] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ item: CollectItem; action: "claim" | "return" } | null>(null);
  const [reason, setReason] = useState("");
  const [actor, setActor] = useState(operator);
  const [busyId, setBusyId] = useState("");
  const [discoverNote, setDiscoverNote] = useState(
    "只有操作者能送出。這個行程要設 KOL_SHERLOCK=1，並由本機 Docker 用官方映像 0.16.0 的固定摘要查完即退出。網頁容器與 GitHub Pages 沒有這個入口。Maigret 不從這裡呼叫。",
  );
  const [retryTick, setRetryTick] = useState(0);
  const viewRef = useRef<CollectView | null>(initial);
  viewRef.current = view;

  useEffect(() => {
    const bag = readLocal();
    setLocal(bag);
    setReady(true);
  }, []);

  useEffect(() => {
    setActor(operator || "AD");
  }, [operator]);

  useEffect(() => {
    setStatus({
      link,
      pending: null,
      ms: link === "live" ? ms : null,
    });
  }, [link, ms, setStatus]);

  useEffect(() => {
    let gone = false;
    let timer = 0;

    async function pull() {
      const started = Date.now();
      const ctrl = new AbortController();
      const abortTimer = window.setTimeout(() => ctrl.abort(), 8000);
      try {
        const response = await fetch(COLLECT_PATH, {
          headers: { accept: "application/json" },
          cache: "no-store",
          credentials: "same-origin",
          signal: ctrl.signal,
        });
        if (gone) return;
        if (response.status === 401) {
          requireLogin();
          return;
        }
        if (response.status === 500) {
          setView(null);
          setLink("down");
          setBanner("來源錯誤 · HTTP 500");
          timer = window.setTimeout(pull, RETRY_MS);
          return;
        }
        if (!response.ok) throw new Error("HTTP " + response.status);
        const body = (await response.json()) as unknown;
        const next = deriveCollect(body, started);
        if (!next) throw new Error("收集回應沒有 items");
        writeApiCache(next);
        viewRef.current = next;
        setView(next);
        setLink("live");
        setMs(Math.max(1, Date.now() - started));
        setBanner("");
        timer = window.setTimeout(pull, POLL_MS);
      } catch {
        if (gone) return;
        const kept = viewRef.current || readApiCache();
        if (kept) {
          setView(kept);
          setLink("cache");
          setBanner("後端離線 · 顯示上次資料");
        } else {
          setView(null);
          setLink("down");
          setBanner("後端離線 · 沒有上次資料");
        }
        timer = window.setTimeout(pull, RETRY_MS);
      } finally {
        window.clearTimeout(abortTimer);
      }
    }

    if (!initial && retryTick === 0) {
      const cached = readApiCache();
      if (cached) {
        viewRef.current = cached;
        setView(cached);
        setLink("cache");
        setBanner("後端離線 · 顯示上次資料");
      }
    }
    timer = window.setTimeout(pull, initial && retryTick === 0 ? POLL_MS : 0);
    return () => {
      gone = true;
      window.clearTimeout(timer);
    };
  }, [initial, requireLogin, retryTick]);

  const items = useMemo(() => mergeItems(view?.items || [], ready ? local.items : []), [view, local.items, ready]);
  const counts = view || (ready && local.items.length) ? collectCounts(items) : null;
  const shown = items.filter((item) => filter === "all" || item.state === filter);
  const picked = items.find((item) => item.id === selected) || null;

  function rememberLocal(next: LocalBag) {
    setLocal(next);
    writeLocal(next);
  }

  function onDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const item = draftCollectItem(
      {
        title: String(form.get("title") || ""),
        pri: String(form.get("pri") || "p1"),
        role: String(form.get("role") || "分析席"),
        source: String(form.get("source") || "manual"),
      },
      local.seq,
    );
    if (!item) {
      setNotice("標題不能是空的");
      return;
    }
    rememberLocal({ seq: local.seq + 1, items: [item, ...local.items] });
    setFilter("inbox");
    setNotice(item.id + " 已放入待收。這一筆只在這個瀏覽器。");
    event.currentTarget.reset();
  }

  function patchLocal(id: string, patch: Partial<CollectItem>) {
    rememberLocal({
      seq: local.seq,
      items: local.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });
  }

  async function onDiscover(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = validDiscoverName(String(new FormData(form).get("discover") || ""));
    if (!name) {
      setNotice("用戶名用 2–32 位英數、點、底線或連字號");
      return;
    }
    setBusyId("discover");
    setDiscoverNote("正在用 Docker 啟動 Sherlock…");
    try {
      const response = await fetch("/__sherlock", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const raw = await response.text();
      let data: { ok?: boolean; message?: string; hits?: { site?: string }[] } = {};
      try {
        data = raw ? (JSON.parse(raw) as typeof data) : {};
      } catch {
        data = {};
      }
      if (!data.ok) {
        const message = data.message || (response.status === 409 ? "已有一次查詢在跑" : "Sherlock 沒有完成");
        setDiscoverNote(message);
        setNotice(message);
        return;
      }
      const hits = Array.isArray(data.hits) ? data.hits : [];
      const brief = hits
        .slice(0, 8)
        .map((hit) => hit.site)
        .filter(Boolean)
        .join("、");
      const note = "Sherlock 容器找到 " + hits.length + " 個公開頁面" + (brief ? "：" + brief : "") + "。結果留在這頁，不寫入隊列。";
      const id = "D-" + local.seq;
      const item: CollectItem = {
        id,
        accountId: null,
        title: "Sherlock " + name,
        source: "sherlock",
        pri: "p2",
        priLabel: "P2",
        role: "審核席",
        state: "inbox",
        note,
        taskId: "",
        decidedBy: "",
        local: true,
      };
      rememberLocal({ seq: local.seq + 1, items: [item, ...local.items] });
      setFilter("inbox");
      setDiscoverNote(name + "：" + note);
      setNotice(name + " 找到 " + hits.length + " 個公開頁面");
      form.reset();
    } catch {
      setDiscoverNote("連不到本機的 /__sherlock。請用 node tests/dev-server.mjs 開這個站。");
      setNotice("連不到本機 Sherlock 入口");
    } finally {
      setBusyId("");
    }
  }

  async function confirmDialog(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;
    const why = reason.trim();
    if (!why) {
      setNotice("請填寫操作原因");
      return;
    }
    const who = actor.trim() || "AD";
    const item = dialog.item;
    if (!item.accountId) return;
    setBusyId(item.id);
    try {
      const response = await fetch("/api/collect/" + encodeURIComponent(String(item.accountId)) + "/" + dialog.action, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(
          dialog.action === "return" ? { actor: who, note: why, reason: why } : { actor: who, note: why },
        ),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; taskId?: string; actor?: string };
      if (!response.ok) {
        setNotice("後端拒絕：" + (data.error || "HTTP " + response.status));
        return;
      }
      const taskId = String(data.taskId || "");
      const nextItem: CollectItem =
        dialog.action === "claim"
          ? {
              ...item,
              state: "queued",
              taskId,
              note: "已由 " + (data.actor || who) + " 認領" + (taskId ? "（" + taskId + "）" : ""),
              decidedBy: data.actor || who,
            }
          : { ...item, state: "skip", note: "已退回：" + why, decidedBy: data.actor || who };
      setView((current) =>
        current
          ? { ...current, items: current.items.map((row) => (row.id === item.id ? nextItem : row)) }
          : current,
      );
      setDialog(null);
      setReason("");
      setNotice(item.id + " " + (dialog.action === "claim" ? "已認領 " + taskId : "已退回"));
    } catch {
      setNotice("寫入失敗");
    } finally {
      setBusyId("");
    }
  }

  const stats = counts
    ? [
        ["待收", String(counts.inbox)],
        ["已入列", String(counts.queued)],
        ["已略過", String(counts.skip)],
        ["全部", String(counts.all)],
      ]
    : [
        ["待收", "—"],
        ["已認領", "—"],
        ["已退回", "—"],
      ];

  return (
    <main>
      {banner ? (
        <div className={link === "live" ? "wb-net up" : "wb-net"} role="status">
          <span>{banner}</span>
          <button type="button" onClick={() => setRetryTick((value) => value + 1)}>
            重試
          </button>
        </div>
      ) : null}
      <section className="wb-panel" aria-label="任務收集">
        <div className="wb-panel-head">
          <div className="wb-panel-title">任務收集</div>
          <div className="wb-panel-tools">
            <span className="wb-chip">{link === "live" ? "已連線" : link === "cache" ? "上次資料" : "待同步"}</span>
          </div>
        </div>
        <div className="wb-filters" role="group" aria-label="收集狀態過濾">
          {FILTERS.map((row) => (
            <button
              key={row.id}
              type="button"
              className="mini-btn"
              aria-pressed={filter === row.id}
              onClick={() => setFilter(row.id)}
            >
              {row.label}
            </button>
          ))}
        </div>
        <div className="wb-body">
          {notice ? <p className="wb-note">{notice}</p> : null}
          <div className="wb-collect-stats">
            {stats.map((row) => (
              <div className="wb-collect-stat" key={row[0]}>
                <span>{row[0]}</span>
                <b>{row[1]}</b>
              </div>
            ))}
          </div>
          <div className="wb-collect-layout">
            <form className="wb-collect-form" onSubmit={onDraft}>
              <div className="wb-kicker">新收集項</div>
              <label>
                標題
                <input name="title" maxLength={80} required placeholder="要交給席位的任務" autoComplete="off" />
              </label>
              <label>
                優先
                <select name="pri" defaultValue="p1">
                  <option value="p0">P0</option>
                  <option value="p1">P1</option>
                  <option value="p2">P2</option>
                </select>
              </label>
              <label>
                席位
                <select name="role" defaultValue="分析席">
                  {COLLECT_ROLES.map((role) => (
                    <option key={role}>{role}</option>
                  ))}
                </select>
              </label>
              <label>
                來源
                <select name="source" defaultValue="manual">
                  <option value="manual">手動收集</option>
                  {COLLECT_SOURCES.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.cat} · {row.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="mini-btn">
                放入待收
              </button>
              <p className="wb-note">手動項只留在這個瀏覽器。有帳號編號的認領才寫入 collect_decision，不建立人物。</p>
            </form>
            {canOperate ? (
              <form className="wb-collect-form" onSubmit={onDiscover}>
                <div className="wb-kicker">Sherlock 用戶名</div>
                <label>
                  公開用戶名
                  <input name="discover" maxLength={32} placeholder="英數、點、底線或連字號" autoComplete="off" spellCheck={false} required />
                </label>
                <button type="submit" className="mini-btn" disabled={busyId === "discover"}>
                  {busyId === "discover" ? "查詢中…" : "呼叫 Sherlock"}
                </button>
                <p className="wb-note">{discoverNote}</p>
              </form>
            ) : null}
            <div className="wb-collect-list" aria-label="收集項">
              {!view && !local.items.length ? (
                <div className="wb-empty">沒有來源。數字顯示「—」。</div>
              ) : shown.length ? (
                shown.map((item) => {
                  const src = sourceOf(item.source, view?.sources || {});
                  const queued = item.state === "queued";
                  const skipped = item.state === "skip";
                  return (
                    <article key={item.id} className={selected === item.id ? "wb-ccard is-on" : "wb-ccard"}>
                      <button type="button" className="wb-ccard-open" onClick={() => setSelected(item.id)}>
                        <div className="wb-card-top">
                          <b>{item.id}</b>
                          <span>{item.priLabel}</span>
                          <span>{src.cat}</span>
                        </div>
                        <h3>{item.title}</h3>
                        <div className="wb-card-sub">
                          {src.name} · {item.role} · {src.license}
                        </div>
                        <div className="wb-card-sub">{item.note || "—"}</div>
                      </button>
                      <div className="wb-ccard-actions">
                        {item.state === "inbox" && item.accountId && canWrite ? (
                          <>
                            <button type="button" className="mini-btn" disabled={busyId === item.id} onClick={() => { setDialog({ item, action: "claim" }); setReason(""); }}>
                              認領
                            </button>
                            <button type="button" className="mini-btn" disabled={busyId === item.id} onClick={() => { setDialog({ item, action: "return" }); setReason(""); }}>
                              退回
                            </button>
                          </>
                        ) : null}
                        {item.state === "inbox" && !item.accountId ? (
                          <button
                            type="button"
                            className="mini-btn"
                            onClick={() => {
                              patchLocal(item.id, { state: "skip", note: "已略過。這一筆只在這個瀏覽器。" });
                              setNotice(item.id + " 已略過");
                            }}
                          >
                            略過
                          </button>
                        ) : null}
                        {queued || skipped ? (
                          <span className="wb-pill">{queued ? (item.accountId ? "已認領 " : "已入列 ") + (item.taskId || "") : item.accountId ? "已退回" : "已略過"}</span>
                        ) : null}
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="wb-empty">這個狀態下沒有收集項</div>
              )}
            </div>
          </div>
          {picked ? (
            <aside className="wb-detail" aria-label="這筆收集">
              <div className="wb-kicker">{sourceOf(picked.source, view?.sources || {}).cat}</div>
              <h2>{picked.title}</h2>
              <p>{picked.note || "—"}</p>
              <dl>
                <div>
                  <dt>來源</dt>
                  <dd>
                    {sourceOf(picked.source, view?.sources || {}).name} · {sourceOf(picked.source, view?.sources || {}).cat}
                  </dd>
                </div>
                <div>
                  <dt>許可</dt>
                  <dd>{sourceOf(picked.source, view?.sources || {}).license}</dd>
                </div>
                <div>
                  <dt>席位</dt>
                  <dd>{picked.role}</dd>
                </div>
                <div>
                  <dt>隊列</dt>
                  <dd>{picked.taskId || "還沒入列"}</dd>
                </div>
                <div>
                  <dt>邊界</dt>
                  <dd>認領只做工作分派。不改身份狀態，不建立人物。確認前不進任務隊列，也不在這頁拉取或啟動容器。</dd>
                </div>
              </dl>
            </aside>
          ) : null}
        </div>
      </section>
      {dialog ? (
        <div className="wb-dialog" role="dialog" aria-modal="true" aria-labelledby="collectDlgTitle">
          <form className="wb-dialog-card" onSubmit={confirmDialog}>
            <h2 id="collectDlgTitle">{dialog.action === "claim" ? "認領 " : "退回 "}{dialog.item.id}</h2>
            <p>
              {dialog.item.title}。
              {dialog.action === "claim"
                ? "認領會寫入 collect_decision 與 audit_log，並取得隊列編號。不建立人物。"
                : "退回後不再進隊列，原因會留在 audit_log。"}
            </p>
            <label>
              操作者
              <input value={actor} onChange={(event) => setActor(event.target.value)} maxLength={40} />
            </label>
            <label>
              原因
              <input value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={200} />
            </label>
            <div className="wb-dialog-actions">
              <button type="button" className="mini-btn" onClick={() => setDialog(null)}>
                取消
              </button>
              <button type="submit" className="mini-btn" disabled={busyId === dialog.item.id}>
                確認
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
