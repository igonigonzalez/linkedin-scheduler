import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  createComment,
  createPost,
  refreshAccessToken,
  uploadImage,
  uploadVideo,
  type MediaUrn,
} from "@/lib/linkedin";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds — give media upload room (Vercel function timeout)

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

// Called by an external cron pinger every few minutes:
//   GET /api/cron/publish?secret=CRON_SECRET
// Publishes any posts whose scheduled time has passed.
export async function GET(req: NextRequest) {
  // Accept secret via query param (cron-job.org), x-cron-secret header, or Authorization Bearer (Vercel Cron).
  const qSecret = req.nextUrl.searchParams.get("secret");
  const hSecret = req.headers.get("x-cron-secret");
  const bearer = req.headers.get("authorization")?.replace("Bearer ", "");
  const secret = qSecret || hSecret || bearer;
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const nowIso = new Date().toISOString();

  const { data: due } = await sb
    .from("posts")
    .select("*, media(*)")
    .eq("status", "scheduled")
    .lte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(5);

  const results: { id: string; status: string; detail?: string }[] = [];

  for (const post of due ?? []) {
    // Atomically claim the post so overlapping cron runs don't double-publish.
    const { data: claimed } = await sb
      .from("posts")
      .update({ status: "publishing" })
      .eq("id", post.id)
      .eq("status", "scheduled")
      .select()
      .maybeSingle();
    if (!claimed) continue;

    try {
      const { data: acct } = await sb
        .from("linkedin_accounts")
        .select("*")
        .eq("id", post.account_id)
        .single();
      if (!acct) throw new Error("LinkedIn account not found");

      // Refresh the token if it expires within 2 days.
      let accessToken: string = acct.access_token;
      if (acct.refresh_token && acct.expires_at && new Date(acct.expires_at).getTime() - Date.now() < TWO_DAYS_MS) {
        try {
          const refreshed = await refreshAccessToken(acct.refresh_token);
          accessToken = refreshed.access_token;
          await sb
            .from("linkedin_accounts")
            .update({
              access_token: refreshed.access_token,
              expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
              refresh_token: refreshed.refresh_token ?? acct.refresh_token,
            })
            .eq("id", acct.id);
        } catch {
          // If refresh fails, try the existing token anyway.
        }
      }

      const author: string = acct.member_urn;

      // Upload media to LinkedIn (in declared order).
      const mediaRows = [...(post.media ?? [])].sort(
        (a: { sort_order: number }, b: { sort_order: number }) => (a.sort_order || 0) - (b.sort_order || 0)
      );
      const mediaUrns: MediaUrn[] = [];
      for (const m of mediaRows) {
        const fileRes = await fetch(m.url);
        if (!fileRes.ok) throw new Error(`No se pudo descargar el media: ${m.url}`);
        const bytes = await fileRes.arrayBuffer();
        const ct = fileRes.headers.get("content-type") || "application/octet-stream";
        if (m.type === "video") {
          mediaUrns.push({ type: "video", urn: await uploadVideo(accessToken, author, bytes, ct) });
        } else {
          mediaUrns.push({ type: "image", urn: await uploadImage(accessToken, author, bytes, ct) });
        }
      }

      // Create the post.
      const postUrn = await createPost(accessToken, author, post.body, mediaUrns);

      // First comment (optional).
      let commentUrn: string | null = null;
      if (post.first_comment && post.first_comment.trim()) {
        commentUrn = await createComment(accessToken, author, postUrn, post.first_comment);
      }

      await sb
        .from("posts")
        .update({
          status: "published",
          post_urn: postUrn,
          comment_urn: commentUrn,
          published_at: new Date().toISOString(),
          error: null,
        })
        .eq("id", post.id);
      results.push({ id: post.id, status: "published", detail: postUrn });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await sb.from("posts").update({ status: "failed", error: msg }).eq("id", post.id);
      results.push({ id: post.id, status: "failed", detail: msg });
    }
  }

  return NextResponse.json({ ran_at: nowIso, processed: results.length, results });
}
