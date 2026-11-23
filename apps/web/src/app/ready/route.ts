import { checkComponents, readyStatus } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await checkComponents();
  const status = readyStatus(items);
  return Response.json({ ok: status === 200, items }, { status });
}
