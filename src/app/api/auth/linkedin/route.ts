import { NextResponse } from "next/server";
import { getAuthUrl } from "@/lib/linkedin";

// Starts the LinkedIn OAuth flow.
export async function GET() {
  const state = crypto.randomUUID();
  const res = NextResponse.redirect(getAuthUrl(state));
  res.cookies.set("li_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
