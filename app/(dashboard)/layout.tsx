import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { MobileShell } from "@/components/layout/mobile-shell";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { InstallBanner } from "@/components/pwa/install-banner";
import { SplashScreen } from "@/components/pwa/splash-screen";
import { PullToRefresh } from "@/components/ui/pull-to-refresh";
import { PermissoesProvider } from "@/components/providers/permissoes-provider";
import { ModulosProvider } from "@/components/providers/modulos-provider";
import { AuthSessionProvider } from "@/components/providers/session-provider";
import { RecarregarAoVoltar } from "@/components/pwa/recarregar-ao-voltar";
import { CascaTecnico } from "@/components/tecnico/casca-tecnico";
import { Avisos } from "@/components/ui/avisos";
import { emModoTecnico } from "@/lib/tecnico/modo";
import { modulosDesligados } from "@/lib/modulos/servidor";
import { ehDonoDoFrivo } from "@/lib/anotacoes/dono";
import { AnotacoesCarregador } from "@/components/anotacoes/carregador";
import { SincronizarAcesso } from "@/components/acesso/sincronizar-acesso";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  // Sem sessão válida (inclusive usuário inativado): limpa o cookie e vai para o login
  if (!session) redirect("/sessao-encerrada");

  // Técnico puro: sem o menu do sistema (o middleware só deixa ele aqui no checklist do veículo)
  if (emModoTecnico(session.user)) {
    return (
      <AuthSessionProvider session={session}>
        <PermissoesProvider role={session.user.role} permissoes={session.user.permissoes}>
          <Avisos />
          <SincronizarAcesso mudou={session.user.acessoMudou === true} />
          <CascaTecnico>{children}</CascaTecnico>
        </PermissoesProvider>
      </AuthSessionProvider>
    );
  }

  // Avatar vem do banco (fora do JWT, para não estourar o cookie com base64) e, junto, os MÓDULOS
  // que a empresa desligou: a permissão do usuário também é a do cadastro de agora (lib/sessao-ativa),
  // e o que a empresa tem é lido aqui a cada navegação — desligar um módulo vale na hora, sem derrubar sessão de ninguém.
  const [dbUser, desligados] = await Promise.all([
    prisma.usuario.findUnique({ where: { id: session.user.id }, select: { avatar: true } }),
    modulosDesligados(session.user.empresaId),
  ]);
  const avatarUrl = dbUser?.avatar ?? null;

  return (
    <AuthSessionProvider session={session}>
      <PermissoesProvider role={session.user.role} permissoes={session.user.permissoes}>
       <ModulosProvider desligados={[...desligados]}>
        <div className="flex h-screen overflow-hidden bg-surface-page">
          <Avisos />
          {/* Papel e permissões vêm do cadastro a cada requisição; este mantém o cookie (que o portão
              do middleware lê) igual a eles — conceder ou retirar acesso vale sem sair e entrar */}
          <SincronizarAcesso mudou={session.user.acessoMudou === true} />
          <SplashScreen />
          <RecarregarAoVoltar />
          <Sidebar session={session} avatarUrl={avatarUrl} />
          <MobileShell session={session} avatarUrl={avatarUrl} />
          <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
            <Header session={session} avatarUrl={avatarUrl} />
            <InstallBanner />
            <main id="conteudo-scroll" className="relative flex-1 overflow-y-auto scroller-mobile p-4 sm:p-6 pb-24 lg:pb-6">
              <PullToRefresh scrollTargetId="conteudo-scroll" />
              {children}
            </main>
          </div>
          <MobileBottomNav />
          {/* ANOTAÇÕES INTERNAS — ferramenta de construção do DONO do Frivo (role SUPER_ADMIN), não
              recurso do cliente. Esta é a 1ª das três travas: quem não é o dono não recebe nem a
              tag no HTML, e por isso nem chega a baixar o chunk da ferramenta (a 2ª trava está em
              components/anotacoes/carregador.tsx; a 3ª é o 403 nas rotas). Sem consulta nova:
              o papel já viaja no token da sessão. */}
          {ehDonoDoFrivo(session.user) && <AnotacoesCarregador />}
        </div>
       </ModulosProvider>
      </PermissoesProvider>
    </AuthSessionProvider>
  );
}
