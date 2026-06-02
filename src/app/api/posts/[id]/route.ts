import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionAccountIdFromReq } from "@/lib/session";

function noSession() {
  return NextResponse.json({ error: "Sesión no encontrada." }, { status: 401 });
}

async function ownPost(sb: ReturnType<typeof supabaseAdmin>, postId: string, accountId: string) {
  const { data } = await sb.from("posts").select("id").eq("id", postId).eq("account_id", accountId).maybeSingle();
  return !!data;
}

// Delete a post (CASCADE removes media rows).
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const accountId = getSessionAccountIdFromReq(req);
  if (!accountId) return noSession();

  const sb = supabaseAdmin();
  if (!(await ownPost(sb, id, accountId)))
    return NextResponse.json({ error: "Post no encontrado." }, { status: 404 });

  const { error } = await sb.from("posts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

type MediaIn = { type: "image" | "video"; path: string; url: string };

// Patch: edit text/comment/schedule, replace media, requeue failed.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const accountId = getSessionAccountIdFromReq(req);
  if (!accountId) return noSession();

  const sb = supabaseAdmin();
  if (!(await ownPost(sb, id, accountId)))
    return NextResponse.json({ error: "Post no encontrado." }, { status: 404 });

  const json = (await req.json()) as Partial<{
    body: string;
    first_comment: string | null;
    scheduled_at: string;
    status: string;
    media: MediaIn[];
  }>;

  const { media, ...patch } = json;

  if (Object.keys(patch).length) {
    const { error } = await sb.from("posts").update(patch).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (Array.isArray(media)) {
    const { error: delErr } = await sb.from("media").delete().eq("post_id", id);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    if (media.length) {
      const rows = media.map((m, i) => ({
        post_id: id, type: m.type, path: m.path, url: m.url, sort_order: i,
      }));
      const { error: insErr } = await sb.from("media").insert(rows);
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  const { data } = await sb.from("posts").select("*, media(*)").eq("id", id).single();
  return NextResponse.json({ post: data });
}
