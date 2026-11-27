import { COLLECT_PATH, deriveCollect, type CollectView } from "@/lib/collect-board";
import { upstreamUrl } from "@/lib/queue-load";

export type CollectLoad = {
  view: CollectView | null;
  unauthorized: boolean;
  ms: number;
};

export async function loadCollectView(): Promise<CollectLoad> {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const response = await fetch(upstreamUrl(COLLECT_PATH), {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (response.status === 401) {
      return { view: null, unauthorized: true, ms: Math.max(1, Date.now() - started) };
    }
    if (!response.ok) {
      return { view: null, unauthorized: false, ms: Math.max(1, Date.now() - started) };
    }
    const body = (await response.json()) as unknown;
    return {
      view: deriveCollect(body, started),
      unauthorized: false,
      ms: Math.max(1, Date.now() - started),
    };
  } catch {
    return { view: null, unauthorized: false, ms: Math.max(1, Date.now() - started) };
  } finally {
    clearTimeout(timer);
  }
}
