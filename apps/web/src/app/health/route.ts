import { checkComponents } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await checkComponents();
  return Response.json({ ok: true, items });
}
