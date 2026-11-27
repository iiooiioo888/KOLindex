import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const TOPIC: Record<string, string> = {
  "/": "queue",
  "/queue": "queue",
  "/collect": "collect",
};

export function middleware(request: NextRequest) {
  const topic = TOPIC[request.nextUrl.pathname];
  if (!topic) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/console/index.html";
  url.search = "";
  url.hash = "/" + topic;
  return NextResponse.redirect(url, 307);
}

export const config = {
  matcher: ["/", "/queue", "/collect"],
};
