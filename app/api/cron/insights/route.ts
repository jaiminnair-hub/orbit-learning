import { NextResponse } from "next/server";
import { generateAndPublishTodaysInsight } from "@/lib/lms/insights";

// Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` automatically for
// requests it triggers, once CRON_SECRET is set — https://vercel.com/docs/cron-jobs.
// Same check also lets a real operator (or this session, once) trigger a
// publish manually with the same header.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const article = await generateAndPublishTodaysInsight();
    return NextResponse.json({ ok: true, slug: article.slug, title: article.title });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[cron/insights] publish failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
