import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const BLOCKED_PATHS = [
  "/wp-admin",
  "/wp-login",
  "/wp-content",
  "/wp-includes",
  "/wordpress",
  "/xmlrpc.php",
  "/.env",
  "/config.php",
  "/admin.php",
  "/phpmyadmin",
  "/.git",
];

// Stripe verifies the raw request body, so keep this endpoint off the redirect path.
const NO_REDIRECT_PATHS = ["/api/stripe/webhook"];

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname.toLowerCase();

  if (BLOCKED_PATHS.some((blocked) => path.startsWith(blocked))) {
    return new NextResponse(null, { status: 404 });
  }

  const host = request.headers.get("host") ?? "";
  if (
    host.startsWith("www.") &&
    !NO_REDIRECT_PATHS.some((prefix) => path.startsWith(prefix))
  ) {
    const url = request.nextUrl.clone();
    url.host = host.slice(4);
    return NextResponse.redirect(url, { status: 308 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.svg$).*)",
  ],
};
