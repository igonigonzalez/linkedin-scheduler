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

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const COMMENT_RETRY_WINDOW_MS = 60 * 60 * 1000;
const STUCK_PUBLISHING_MS = 10 * 60 * 1000;

type Sb = ReturnType<typeof supabaseAdmin>;
type Account = {
  id: string;
  member_urn: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
};

export type PublishResult = { id: string; status: string; detail?: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getAccountWithFreshToken(sb: Sb, accountId: string): Promise<{ acct: Account; accessToken: string }> {
  const { data: acct, error } = await sb.from("linkedin_accounts").select("*").eq("id", accountId).single();
  if (error || !acct) throw new Error(error?.message || "LinkedIn account not found");

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
  const { error } = await sb.from("posts").update({ comment_urn: commentUrn, error: commentError }).eq("id", postId);
  if (error) throw new Error(error.message);
  return { commentUrn, commentError };
}

// A crashed publish leaves the row in `publishing`. Requeue it once the lease is stale
// so the next run can try again instead of leaving it stuck forever.
export async function recoverStuckPublishing(sb: Sb) {
  const cutoff = new Date(Date.now() - STUCK_PUBLISHING_MS).toISOString();
  const patch = {
    status: "scheduled",
    error: "La publicación anterior no terminó. Se reintentará.",
    updated_at: new Date().toISOString(),
  };
  const stale = await sb.from("posts").update(patch).eq("status", "publishing").lt("updated_at", cutoff);
  if (stale.error) throw new Error(stale.error.message);
  const missing = await sb.from("posts").update(patch).eq("status", "publishing").is("updated_at", null);
  if (missing.error) throw new Error(missing.error.message);
}

// Claim one scheduled post and publish it. Returns null if another run already claimed it.
export async function publishPostById(sb: Sb, postId: string): Promise<PublishResult | null> {
  const { data: post, error } = await sb.from("posts").select("*, media(*)").eq("id", postId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!post || post.status !== "scheduled") return null;

  const { data: claimed, error: claimErr } = await sb
    .from("posts")
    .update({ status: "publishing", updated_at: new Date().toISOString() })
    .eq("id", post.id)
    .eq("status", "scheduled")
    .select("id")
    .maybeSingle();
  if (claimErr) throw new Error(claimErr.message);
  if (!claimed) return null;

  try {
    const { acct, accessToken } = await getAccountWithFreshToken(sb, post.account_id);
    const author: string = acct.member_urn;

    const mediaRows = [...(post.media ?? [])].sort(
      (a: { sort_order: number }, b: { sort_order: number }) => (a.sort_order || 0) - (b.sort_order || 0)
    );
    const mediaUrns: MediaUrn[] = [];
      for (const m of mediaRows) {
        const { data: file, error: dlErr } = await sb.storage.from("media").download(m.path);
        if (dlErr || !file) throw new Error(dlErr?.message || `No se pudo descargar el media: ${m.path}`);
        const bytes = await file.arrayBuffer();
        const ct = file.type || "application/octet-stream";
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

    const postUrn = await createPost(accessToken, author, post.body, mediaUrns);

    const { error: publishedErr } = await sb
      .from("posts")
      .update({
        status: "published",
        post_urn: postUrn,
        published_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", post.id);
    if (publishedErr) throw new Error(publishedErr.message);

    let commentError: string | null = null;
    if (post.first_comment && post.first_comment.trim()) {
      const delays = mediaUrns.length > 0 ? [4000, 8000] : [];
      ({ commentError } = await tryFirstComment(
        sb, post.id, accessToken, author, postUrn, post.first_comment, delays
      ));
    }

    return {
      id: post.id,
      status: "published",
      detail: commentError ? `${postUrn} (comment pending: ${commentError})` : postUrn,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("posts").update({
      status: "failed",
      error: msg,
      updated_at: new Date().toISOString(),
    }).eq("id", post.id);
    return { id: post.id, status: "failed", detail: msg };
  }
}

export async function retryPendingComments(sb: Sb, skipIds: Set<string>): Promise<PublishResult[]> {
  const windowStart = new Date(Date.now() - COMMENT_RETRY_WINDOW_MS).toISOString();
  const { data: pending, error } = await sb
    .from("posts")
    .select("id, account_id, post_urn, first_comment")
    .eq("status", "published")
    .is("comment_urn", null)
    .not("first_comment", "is", null)
    .not("post_urn", "is", null)
    .gte("published_at", windowStart)
    .limit(5);
  if (error) throw new Error(error.message);

  const results: PublishResult[] = [];
  for (const post of pending ?? []) {
    if (skipIds.has(post.id) || !post.first_comment?.trim()) continue;
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
      results.push({
        id: post.id,
        status: "comment_retry_failed",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}

export async function publishDuePosts(sb: Sb): Promise<{ ranAt: string; results: PublishResult[] }> {
  await recoverStuckPublishing(sb);
  const ranAt = new Date().toISOString();
  const { data: due, error } = await sb
    .from("posts")
    .select("id")
    .eq("status", "scheduled")
    .lte("scheduled_at", ranAt)
    .order("scheduled_at", { ascending: true })
    .limit(5);
  if (error) throw new Error(error.message);

  const results: PublishResult[] = [];
  for (const row of due ?? []) {
    const result = await publishPostById(sb, row.id);
    if (result) results.push(result);
  }
  const comments = await retryPendingComments(sb, new Set(results.map((result) => result.id)));
  return { ranAt, results: [...results, ...comments] };
}
