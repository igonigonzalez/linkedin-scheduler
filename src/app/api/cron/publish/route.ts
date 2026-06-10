import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  createComment,
  createPost,
  refreshAccessToken,
  uploadDocument,
  uploadImage,
  uploadVideo,
  type MediaUrn,
} from "@/lib/linkedin";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds — give media upload room (Vercel function timeout)

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
// How long after publishing we keep retrying a pending first comment (covers LinkedIn's
// async processing of videos/PDFs, during which the comments endpoint 404s).
const COMMENT_RETRY_WINDOW_MS = 60 * 60 * 1000;

type Sb = ReturnType<typeof supabaseAdmin>;
type Account = { id: string; member_urn: string; access_token: string; refresh_token: string | null; expires_at: string | null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fetch the account and refresh its token if it expires within 2 days.
async function getAccountWithFreshToken(sb: Sb, accountId: string): Promise<{ acct: Account; accessToken: string }> {
  const { data: acct } = await sb.from("linkedin_accounts").select("*").eq("id", accountId).single();
  if (!acct) throw new Error("LinkedIn account not found");

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
  return { acct, accessToken };
}

// Try the first comment and persist the result. LinkedIn 404s on freshly created media posts
// (ugcPost) until async processing finishes, so on 404 we retry in-run with short waits; if it
// still fails, the pending-comments pass of a later cron run picks it up (comment_urn stays null).
async function tryFirstComment(
  sb: Sb,
  postId: string,
  accessToken: string,
  actor: string,
  postUrn: string,
  text: string,
  retryDelaysMs: number[]
): Promise<{ commentUrn: string | null; commentError: string | null }> {
  let commentUrn: string | null = null;
  let commentError: string | null = null;
  for (let attempt = 0; ; attempt++) {
    try {
      commentUrn = await createComment(accessToken, actor, postUrn, text);
      commentError = null;
      break;
    } catch (e) {
      commentError = e instanceof Error ? e.message : String(e);
      const transient = commentError.includes("404");
      if (!transient || attempt >= retryDelaysMs.length) break;
      await sleep(retryDelaysMs[attempt]);
    }
  }
  await sb.from("posts").update({ comment_urn: commentUrn, error: commentError }).eq("id", postId);
  return { commentUrn, commentError };
}

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
  const handledThisRun = new Set<string>();

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
      const { acct, accessToken } = await getAccountWithFreshToken(sb, post.account_id);
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
        } else if (m.type === "document") {
          mediaUrns.push({
            type: "document",
            urn: await uploadDocument(accessToken, author, bytes, ct),
            title: m.title ?? undefined,
          });
        } else {
          mediaUrns.push({ type: "image", urn: await uploadImage(accessToken, author, bytes, ct) });
        }
      }

      // Create the post.
      const postUrn = await createPost(accessToken, author, post.body, mediaUrns);

      // Commit the post as published immediately. The first comment below is best-effort:
      // if it fails we must NOT mark the whole post failed (it's already live) nor lose the
      // post_urn, and a failed status would let a later cron run re-publish a duplicate.
      await sb
        .from("posts")
        .update({
          status: "published",
          post_urn: postUrn,
          published_at: new Date().toISOString(),
          error: null,
        })
        .eq("id", post.id);
      handledThisRun.add(post.id);

      // First comment (optional, best-effort). In-run retries only for media posts: text-only
      // posts don't hit the async-processing 404, and the waits eat into the 60s budget.
      let commentError: string | null = null;
      if (post.first_comment && post.first_comment.trim()) {
        const delays = mediaUrns.length > 0 ? [4000, 8000] : [];
        ({ commentError } = await tryFirstComment(
          sb, post.id, accessToken, author, postUrn, post.first_comment, delays
        ));
      }

      results.push({
        id: post.id,
        status: "published",
        detail: commentError ? `${postUrn} (comment pending: ${commentError})` : postUrn,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await sb.from("posts").update({ status: "failed", error: msg }).eq("id", post.id);
      results.push({ id: post.id, status: "failed", detail: msg });
    }
  }

  // Second pass: retry first comments that are still pending on recently published posts
  // (e.g. a video/PDF that LinkedIn was still processing when the post went live).
  const windowStart = new Date(Date.now() - COMMENT_RETRY_WINDOW_MS).toISOString();
  const { data: pending } = await sb
    .from("posts")
    .select("id, account_id, post_urn, first_comment")
    .eq("status", "published")
    .is("comment_urn", null)
    .not("first_comment", "is", null)
    .not("post_urn", "is", null)
    .gte("published_at", windowStart)
    .limit(5);

  for (const post of pending ?? []) {
    if (handledThisRun.has(post.id) || !post.first_comment?.trim()) continue;
    try {
      const { acct, accessToken } = await getAccountWithFreshToken(sb, post.account_id);
      const { commentUrn, commentError } = await tryFirstComment(
        sb, post.id, accessToken, acct.member_urn, post.post_urn!, post.first_comment, []
      );
      results.push({
        id: post.id,
        status: commentUrn ? "comment_published" : "comment_retry_failed",
        detail: commentError ?? undefined,
      });
    } catch (e) {
      results.push({ id: post.id, status: "comment_retry_failed", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ ran_at: nowIso, processed: results.length, results });
}
