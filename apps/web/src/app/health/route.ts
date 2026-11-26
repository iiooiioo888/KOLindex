import { checkComponentsReport } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const report = await checkComponentsReport();
  return Response.json({
    ok: report.ok,
    items: report.items,
    docker: report.docker,
    duration_ms: report.duration_ms,
    source: report.source,
    note: report.note,
  });
}
