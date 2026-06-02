import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// Issues a signed upload URL so the browser can upload media directly to Supabase Storage
// (avoids Vercel's serverless request body size limit, important for video).
export async function POST(req: NextRequest) {
  const { filename } = (await req.json()) as { filename?: string };
  if (!filename) {
    return NextResponse.json({ error: "filename required" }, { status: 400 });
  }

  const ext = filename.includes(".") ? filename.split(".").pop() : "bin";
  const path = `${crypto.randomUUID()}.${ext}`;

  const sb = supabaseAdmin();
  const { data, error } = await sb.storage.from("media").createSignedUploadUrl(path);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: pub } = sb.storage.from("media").getPublicUrl(path);
  return NextResponse.json({ path: data.path, token: data.token, url: pub.publicUrl });
}
