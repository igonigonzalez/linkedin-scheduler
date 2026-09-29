import { NextRequest, NextResponse } from "next/server";

// Lightweight HTTP Basic Auth for the whole UI + API, enabled only when APP_PASSWORD is set.
// The cron endpoint and the OAuth routes are excluded (see matcher) because they are called
// by external services (cron pinger, LinkedIn redirect) that cannot send a Basic Auth header.
export function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    try {
      const [user, pass] = atob(auth.slice(6)).split(":");
      if (user === "admin" && pass === password) return NextResponse.next();
    } catch {
      // fall through to 401
    }
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="linkedin-scheduler"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/cron|api/auth|privacidad).*)"],
};
