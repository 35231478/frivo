import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const rotasPublicas = ["/login", "/api/auth", "/orcamento/", "/api/publico/"];

export default auth(function middleware(req: NextRequest & { auth: any }) {
  const { pathname } = req.nextUrl;

  const ehRotaPublica = rotasPublicas.some((rota) => pathname.startsWith(rota));

  if (!req.auth && !ehRotaPublica) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (req.auth && pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
