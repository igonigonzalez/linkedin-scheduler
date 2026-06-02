import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionAccountIdFromReq } from "@/lib/session";

export const dynamic = "force-dynamic";

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
  return NextResponse.json({ posts: data ?? [] });
}

type MediaIn = { type: "image" | "video"; path: string; url: string };

// Create a scheduled post for the current session user.
export async function POST(req: NextRequest) {
  const accountId = getSessionAccountIdFromReq(req);
  if (!accountId) return noSession();

  const sb = supabaseAdmin();
  const body = (await req.json()) as {
    body?: string;
    first_comment?: string;
    scheduled_at?: string;
    media?: MediaIn[];
  };

  if (!body.body?.trim())
    return NextResponse.json({ error: "El texto del post es obligatorio" }, { status: 400 });
  if (!body.scheduled_at)
    return NextResponse.json({ error: "Falta la fecha de programación" }, { status: 400 });

  // Verify the account still exists.
  const { data: account } = await sb.from("linkedin_accounts").select("id").eq("id", accountId).maybeSingle();
  if (!account)
    return NextResponse.json({ error: "Cuenta no encontrada. Reconecta LinkedIn." }, { status: 400 });

  const { data: post, error } = await sb
    .from("posts")
    .insert({
      account_id: accountId,
      body: body.body,
      first_comment: body.first_comment?.trim() || null,
      scheduled_at: body.scheduled_at,
      status: "scheduled",
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (body.media?.length) {
    const rows = body.media.map((m, i) => ({
      post_id: post.id, type: m.type, path: m.path, url: m.url, sort_order: i,
    }));
    const { error: mErr } = await sb.from("media").insert(rows);
    if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
  }

  return NextResponse.json({ post });
}
