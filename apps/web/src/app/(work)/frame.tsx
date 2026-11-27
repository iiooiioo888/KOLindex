"use client";

export type WorkLink = "live" | "cache" | "down";

export type WorkStatus = {
  link: WorkLink;
  pending: number | null;
  ms: number | null;
};

export function useWorkbench() {
  return {
    setStatus: (_status: WorkStatus) => {},
    requireLogin: () => {},
    operator: "",
    canWrite: false,
    canOperate: false,
  };
}

export function WorkbenchFrame({ children }: { children: React.ReactNode }) {
  return children;
}
