import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { publishDuePosts } from "@/lib/publish";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds — give media upload room (Vercel function timeout)

// Called by an external cron pinger every few minutes:
//   GET /api/cron/publish?secret=CRON_SECRET
// Publishes any posts whose scheduled time has passed, then retries pending first comments.
export async function GET(req: NextRequest) {
  // Accept secret via query param (cron-job.org), x-cron-secret header, or Authorization Bearer (Vercel Cron).
  const qSecret = req.nextUrl.searchParams.get("secret");
  const hSecret = req.headers.get("x-cron-secret");
  const bearer = req.headers.get("authorization")?.replace("Bearer ", "");
  const secret = qSecret || hSecret || bearer;
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { ranAt, results } = await publishDuePosts(supabaseAdmin());
    return NextResponse.json({ ran_at: ranAt, processed: results.length, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
