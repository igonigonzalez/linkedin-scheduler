import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSessionAccountIdFromReq } from "@/lib/session";

// Issues a signed upload URL so the browser can upload media directly to Supabase Storage
// (avoids Vercel's serverless request body size limit, important for video).
export async function POST(req: NextRequest) {
  const accountId = getSessionAccountIdFromReq(req);
  if (!accountId) {
    return NextResponse.json({ error: "Sesión no encontrada. Conecta LinkedIn primero." }, { status: 401 });
  }

  const { filename } = (await req.json()) as { filename?: string };
  if (!filename) {
    return NextResponse.json({ error: "filename required" }, { status: 400 });
  }

  const rawExt = filename.includes(".") ? filename.split(".").pop() || "bin" : "bin";
  const ext = rawExt.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "bin";
  const path = `${accountId}/${crypto.randomUUID()}.${ext}`;

  const sb = supabaseAdmin();
  const { data: account, error: accountErr } = await sb
    .from("linkedin_accounts")
    .select("id")
    .eq("id", accountId)
    .maybeSingle();
  if (accountErr) return NextResponse.json({ error: accountErr.message }, { status: 500 });
  if (!account) return NextResponse.json({ error: "Cuenta no encontrada. Reconecta LinkedIn." }, { status: 401 });

  const { data, error } = await sb.storage.from("media").createSignedUploadUrl(path);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: signed, error: signErr } = await sb.storage.from("media").createSignedUrl(path, 60 * 60 * 2);
  if (signErr || !signed) return NextResponse.json({ error: signErr?.message || "No se pudo firmar el archivo" }, { status: 500 });
  return NextResponse.json({ path: data.path, token: data.token, url: signed.signedUrl });
}
