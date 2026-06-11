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
import { AuthSessionProvider } from "@/components/providers/session-provider";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");

  // Avatar vem do banco (fora do JWT, para não estourar o cookie com base64)
  const dbUser = await prisma.usuario.findUnique({ where: { id: session.user.id }, select: { avatar: true } });
  const avatarUrl = dbUser?.avatar ?? null;

  return (
    <AuthSessionProvider session={session}>
      <PermissoesProvider role={session.user.role} permissoes={session.user.permissoes}>
        <div className="flex h-screen overflow-hidden bg-surface-page">
          <SplashScreen />
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
        </div>
      </PermissoesProvider>
    </AuthSessionProvider>
  );
}
