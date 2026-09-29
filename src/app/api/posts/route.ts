import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionAccountIdFromReq } from "@/lib/session";
import { publishPostById } from "@/lib/publish";
import { signPosts } from "@/lib/mediaAccess";
import { normalizeComment, validateContent, validateMedia, validateSchedule, type MediaIn } from "@/lib/postInput";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PUBLISH_NOW_SKEW_MS = 15_000;

function noSession() {
  return NextResponse.json({ error: "Sesión no encontrada. Conecta LinkedIn primero." }, { status: 401 });
}

// List posts for the current session user.
export async function GET(req: NextRequest) {
  const accountId = getSessionAccountIdFromReq(req);
  if (!accountId) return noSession();

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("posts")
    .select("*, media(*)")
    .eq("account_id", accountId)
    .order("scheduled_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ posts: await signPosts(sb, data ?? []) });
}

// Create a scheduled post for the current session user.
// A time of "now" (or in the past) publishes in this request instead of waiting for cron.
export async function POST(req: NextRequest) {
  const accountId = getSessionAccountIdFromReq(req);
  if (!accountId) return noSession();

  const body = (await req.json()) as {
    body?: string;
    first_comment?: string;
    scheduled_at?: string;
    media?: MediaIn[];
  };

  const text = body.body ?? "";
  const comment = normalizeComment(body.first_comment);
  const invalid =
    validateContent(text, comment) ||
    validateSchedule(body.scheduled_at ?? "") ||
    validateMedia(body.media);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const sb = supabaseAdmin();
  const { data: account, error: accountErr } = await sb
    .from("linkedin_accounts")
    .select("id")
    .eq("id", accountId)
    .maybeSingle();
  if (accountErr) return NextResponse.json({ error: accountErr.message }, { status: 500 });
  if (!account) return NextResponse.json({ error: "Cuenta no encontrada. Reconecta LinkedIn." }, { status: 400 });

  const { data: post, error } = await sb
    .from("posts")
    .insert({
      account_id: accountId,
      body: text,
      first_comment: comment,
      scheduled_at: body.scheduled_at,
      status: "scheduled",
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (body.media?.length) {
    const rows = body.media.map((m, i) => ({
      post_id: post.id,
      type: m.type,
      path: m.path,
      url: m.url,
      sort_order: i,
      // Only set title when present (documents) so image/video inserts don't reference the
      // column before the `media.title` migration has been applied.
      ...(m.title ? { title: m.title } : {}),
    }));
    const { error: mErr } = await sb.from("media").insert(rows);
    if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
  }

  const publishNow = new Date(body.scheduled_at!).getTime() <= Date.now() + PUBLISH_NOW_SKEW_MS;
  let publish = null;
  if (publishNow) {
    try {
      publish = await publishPostById(sb, post.id);
    } catch (e) {
      publish = { id: post.id, status: "failed", detail: e instanceof Error ? e.message : String(e) };
    }
  }
  const { data: fresh } = await sb.from("posts").select("*, media(*)").eq("id", post.id).single();
  const [signed] = await signPosts(sb, [fresh ?? post]);
  return NextResponse.json({ post: signed, publish });
}
