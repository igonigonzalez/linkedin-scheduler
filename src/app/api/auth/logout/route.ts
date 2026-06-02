import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

export async function GET() {
  const res = NextResponse.redirect(
    new URL("/", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000")
  );
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
