import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionAccountIdFromReq } from "@/lib/session";
import { normalizeComment, validateContent, validateMedia, validateSchedule, type MediaIn } from "@/lib/postInput";
import { signPosts } from "@/lib/mediaAccess";

function noSession() {
  return NextResponse.json({ error: "Sesión no encontrada." }, { status: 401 });
}

async function removeStorage(sb: ReturnType<typeof supabaseAdmin>, paths: string[]) {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return null;
  const { error } = await sb.storage.from("media").remove(unique);
  return error?.message ?? null;
}

// Delete a post, its media rows (CASCADE) and the storage objects.
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const accountId = getSessionAccountIdFromReq(req);
  if (!accountId) return noSession();

  const sb = supabaseAdmin();
  const { data: post, error: lookupErr } = await sb
    .from("posts")
    .select("id, media(path)")
    .eq("id", id)
    .eq("account_id", accountId)
    .maybeSingle();
  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  if (!post) return NextResponse.json({ error: "Post no encontrado." }, { status: 404 });

  const paths = (post.media ?? []).map((item: { path: string }) => item.path);
  const storageErr = await removeStorage(sb, paths);
  if (storageErr) return NextResponse.json({ error: storageErr }, { status: 500 });

  const { error } = await sb.from("posts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// Patch: edit text/comment/schedule and replace media. Published posts stay published.
// A failed post can be requeued by sending status: "scheduled".
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const accountId = getSessionAccountIdFromReq(req);
  if (!accountId) return noSession();

  const sb = supabaseAdmin();
  const { data: current, error: lookupErr } = await sb
    .from("posts")
    .select("id, status, body, first_comment")
    .eq("id", id)
    .eq("account_id", accountId)
    .maybeSingle();
  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: "Post no encontrado." }, { status: 404 });
  if (current.status === "published" || current.status === "publishing") {
    return NextResponse.json({ error: "Un post publicado o en curso no se puede editar." }, { status: 409 });
  }

  const json = (await req.json()) as Partial<{
    body: string;
    first_comment: string | null;
    scheduled_at: string;
    status: string;
    media: MediaIn[];
  }>;

  if (json.status !== undefined && json.status !== "scheduled") {
    return NextResponse.json({ error: "Estado no permitido." }, { status: 400 });
  }
  if (json.status === "scheduled" && current.status !== "failed" && current.status !== "scheduled") {
    return NextResponse.json({ error: "Este post no se puede volver a programar." }, { status: 409 });
  }

  const nextBody = typeof json.body === "string" ? json.body : current.body;
  const nextComment = json.first_comment !== undefined ? normalizeComment(json.first_comment) : current.first_comment;
  const invalid =
    validateContent(nextBody, nextComment) ||
    (typeof json.scheduled_at === "string" ? validateSchedule(json.scheduled_at) : null) ||
    (Array.isArray(json.media) ? validateMedia(json.media) : null);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof json.body === "string") patch.body = json.body;
  if (json.first_comment !== undefined) patch.first_comment = nextComment;
  if (typeof json.scheduled_at === "string") patch.scheduled_at = json.scheduled_at;
  if (json.status === "scheduled" && current.status === "failed") {
    patch.status = "scheduled";
    patch.error = null;
  }

  const { error } = await sb.from("posts").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (Array.isArray(json.media)) {
    const { data: existing, error: existingErr } = await sb.from("media").select("path").eq("post_id", id);
    if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 });
    const keep = new Set(json.media.map((item) => item.path));
    const dropped = (existing ?? []).map((item) => item.path).filter((path) => !keep.has(path));
    const storageErr = await removeStorage(sb, dropped);
    if (storageErr) return NextResponse.json({ error: storageErr }, { status: 500 });

    const { error: delErr } = await sb.from("media").delete().eq("post_id", id);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    if (json.media.length) {
      const rows = json.media.map((m, i) => ({
        post_id: id,
        type: m.type,
        path: m.path,
        url: m.url,
        sort_order: i,
        ...(m.title ? { title: m.title } : {}),
      }));
      const { error: insErr } = await sb.from("media").insert(rows);
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  const { data } = await sb.from("posts").select("*, media(*)").eq("id", id).single();
  const [signed] = data ? await signPosts(sb, [data]) : [null];
  return NextResponse.json({ post: signed });
}
