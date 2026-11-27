export function upstreamUrl(path: string): string {
  const api = (process.env.KOL_API || "http://127.0.0.1:5210").replace(/\/+$/, "");
  return api + (path.startsWith("/") ? path : `/${path}`);
}
