import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authConfig } from "@/auth.config";
import { moduloDaRota, pode } from "@/lib/permissoes";

// Instância leve do Auth.js (sem provider/bcrypt/Prisma) — apenas lê e verifica o
// JWT da sessão. Isso mantém o bundle do middleware bem abaixo do limite do Edge.
const { auth } = NextAuth(authConfig);

// Rotas liberadas (sem sessão). Mantém as barras finais onde necessário para não
// liberar rotas protegidas semelhantes (ex.: "/qr/" não libera "/qrcodes";
// "/orcamento/" não libera "/orcamentos").
const rotasPublicas = [
  "/login",
  "/api/auth",        // endpoints internos do Auth.js
  "/api/webhooks",    // webhooks externos (ex.: Banco Inter)
  "/api/email/processar-lembretes", // cron (valida CRON_SECRET internamente)
  "/portal",          // inclui /portal/login
  "/api/portal-auth",
  "/api/portal/",
  "/orcamento/",
  "/medicao/",
  "/relatorio/",
  "/api/publico/",
  "/qr/",
  "/api/qr/",
  "/instalar",
  "/offline",
  "/sw.js",
  "/manifest.json",
];

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

  // Controle de acesso por perfil: se a rota exige um módulo e o usuário não tem
  // permissão de visualizar, redireciona para /sem-permissao (ADMIN passa direto).
  if (req.auth && !ehRotaPublica) {
    const modulo = moduloDaRota(pathname);
    const user = req.auth.user;
    if (modulo && pathname !== "/sem-permissao" && !pode(user?.permissoes, modulo, "visualizar", user?.role)) {
      return NextResponse.redirect(new URL("/sem-permissao", req.url));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Ignora assets estáticos e arquivos do PWA (service worker, workbox, manifest, ícones)
    "/((?!_next/static|_next/image|favicon.ico|sw.js|swe-worker-.*|workbox-.*|fallback-.*|manifest.json|icons/.*|.*\\.png$).*)",
  ],
};
