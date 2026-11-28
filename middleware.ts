import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { authConfig } from "@/auth.config";
import { destinoSemPermissao, portaoBarra } from "@/lib/permissoes";
import { apagarCookiesDaSessao, loginAposEncerrar, semCookieDaSessao } from "@/lib/acesso/cookie-sessao";
import { ROTA_TECNICO, destinoModoTecnico, emModoTecnico } from "@/lib/tecnico/modo";
import { MENSAGEM_TROCA_PENDENTE, decisaoDaTroca, trocaPendente } from "@/lib/acesso/troca-obrigatoria";

// Instância leve do Auth.js (sem provider/bcrypt/Prisma) — apenas lê e verifica o
// JWT da sessão. Isso mantém o bundle do middleware bem abaixo do limite do Edge.
const { auth } = NextAuth(authConfig);

// Rotas liberadas (sem sessão). Mantém as barras finais onde necessário para não
// liberar rotas protegidas semelhantes (ex.: "/qr/" não libera "/qrcodes";
// "/orcamento/" não libera "/orcamentos").
const rotasPublicas = [
  "/login",
  "/sessao-encerrada", // limpa o cookie de uma sessão que o servidor já não aceita
  "/definir-senha",    // convite de usuário e "esqueci a senha" (link assinado, uso único)
  "/esqueci-senha",    // pede o link de nova senha (resposta sempre genérica)
  "/api/auth",        // endpoints internos do Auth.js
  "/api/webhooks",    // webhooks externos (ex.: Banco Inter)
  "/api/email/processar-lembretes", // cron (valida CRON_SECRET internamente)
  "/api/fiscal/reconciliar", // cron das NFS-e paradas (valida CRON_SECRET internamente)
  "/api/cron/faturar-contratos", // cron do faturamento automático dos contratos (valida CRON_SECRET internamente)
  "/api/cron/lembretes-pedido", // cron dos lembretes do pedido do cliente (valida CRON_SECRET internamente)
  "/api/cron/push",  // agendador externo das notificações push (valida CRON_SECRET internamente)
  "/portal",          // inclui /portal/login
  "/api/portal-auth",
  "/api/portal/",
  "/orcamento/",
  "/pedido-compra/",  // PC para o fornecedor (link com token, sem preço)
  "/medicao/",
  "/relatorio/",
  "/api/publico/",
  "/admissao/",      // link da admissão digital (a barra final não libera "/admissoes", do RH)
  "/documentacao/",  // link da documentação da equipe, que o cliente abre (não libera "/documentacao-equipe", da empresa)
  "/qr/",
  "/api/qr/",
  "/calculadora",     // calculadora de BTU pública (lead do site, sem login)
  "/privacidade",     // páginas institucionais públicas (sem login, indexáveis)
  "/faq",
  "/termos",
  "/teste-gratis",    // destino do CTA da home de vendas
  "/marketing/",      // prints da home de vendas (public/marketing)
  "/opengraph-image", // imagem de compartilhamento da home de vendas
  "/instalar",
  "/offline",
  "/sw.js",
  "/manifest.json",
];

// Públicas por caminho EXATO: a home de vendas ("/" como prefixo liberaria o sistema inteiro).
const rotasPublicasExatas = ["/"];

const portao = auth(function middleware(req: NextRequest & { auth: any }) {
  const { pathname } = req.nextUrl;

  const ehRotaPublica = rotasPublicasExatas.includes(pathname) || rotasPublicas.some((rota) => pathname.startsWith(rota));

  if (!req.auth && !ehRotaPublica) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Quem já está logado não vê o login nem a home de vendas: vai direto para o trabalho (o login aberto
  // por /sessao-encerrada nem chega aqui: ver o export abaixo)
  if (req.auth && (pathname === "/login" || pathname === "/")) {
    return NextResponse.redirect(new URL(emModoTecnico(req.auth.user) ? ROTA_TECNICO : "/dashboard", req.url));
  }

  // Troca de senha no 1º acesso: com a senha definida por outra pessoa e ainda não trocada, só a tela
  // de troca abre (e sair). Página → a tela de troca; API → 403, sem fazer nada (lib/acesso/troca-obrigatoria).
  if (req.auth && !ehRotaPublica) {
    const troca = decisaoDaTroca(pathname, req.auth.user);
    if (troca?.tipo === "api") return NextResponse.json({ erro: MENSAGEM_TROCA_PENDENTE }, { status: 403 });
    if (troca) return NextResponse.redirect(new URL(troca.destino, req.url));
    // Troca pendente num caminho liberado (a tela ou a rota da troca): nada mais decide aqui. O modo
    // técnico mandaria a tela de troca para o app, e o app de volta para a troca (ciclo).
    if (trocaPendente(req.auth.user)) return NextResponse.next();
  }

  // Modo técnico: o técnico puro fica no app de campo (Meu dia · Agenda · Perfil); o resto do
  // sistema leva para "Meu dia" (link antigo de execução abre a mesma atividade no app)
  if (req.auth && !ehRotaPublica && emModoTecnico(req.auth.user)) {
    const destino = destinoModoTecnico(pathname);
    if (destino) return NextResponse.redirect(new URL(destino, req.url));
  }

  // Controle de acesso por perfil: se a rota exige um módulo e o usuário não pode entrar nele
  // (lib/permissoes.ts › podeEntrarNoModulo), redireciona para /sem-permissao (ADMIN passa direto).
  // O endereço pedido vai junto (`de`): se o acesso foi concedido depois do login, o token daqui
  // ainda é o antigo — /sem-permissao confere no cadastro e devolve a pessoa ao endereço.
  // Rota sem módulo no mapa (lib/permissoes.ts › moduloDaRota) não é rota aberta: é rota em que a
  // PÁGINA confere a permissão certa — a de uma ação que não depende de "visualizar" o módulo.
  if (req.auth && !ehRotaPublica) {
    const user = req.auth.user;
    if (portaoBarra(pathname, user?.permissoes, user?.role)) {
      return NextResponse.redirect(new URL(destinoSemPermissao(pathname), req.url));
    }
  }

  return NextResponse.next();
});

// O middleware LÊ a sessão, mas não regrava o cookie dela: uma resposta que saiu com o cookie antigo
// gravaria o acesso antigo por cima do novo (lib/acesso/cookie-sessao › semCookieDaSessao).
export default async function middleware(req: NextRequest, ev: NextFetchEvent) {
  // BLINDAGEM ANTI-LOOP: o login aberto por /sessao-encerrada (?sessao=encerrada) aparece SEMPRE, mesmo
  // com um cookie que o JWT ainda dá como válido — o servidor já o recusou, e mandar para /dashboard
  // fecharia o ciclo (/dashboard → /sessao-encerrada → /login → /dashboard…, ERR_TOO_MANY_REDIRECTS).
  // E apaga de novo todos os pedaços do cookie da sessão, com os atributos do Auth.js (Secure no __Secure-).
  if (loginAposEncerrar(req.nextUrl)) {
    const res = NextResponse.next();
    apagarCookiesDaSessao(res, req.cookies.getAll().map((c) => c.name));
    return res;
  }
  const res = await portao(req as any, ev as any);
  return res ? semCookieDaSessao(res) : res;
}

export const config = {
  matcher: [
    // Ignora assets estáticos e arquivos do PWA (service worker, workbox, manifest, ícones) e as
    // rotas do próprio Auth.js (/api/auth/*): lá o middleware não decide nada, e o cookie da sessão
    // que ele regrava (com o token que chegou) não pode competir com o que /api/auth/session grava
    // com o acesso atualizado do cadastro (lib/acesso/acesso-atual).
    "/((?!_next/static|_next/image|api/auth/|favicon.ico|sw.js|swe-worker-.*|worker-.*|workbox-.*|fallback-.*|manifest.json|icons/.*|.*\\.png$).*)",
  ],
};
