import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { MobileShell } from "@/components/layout/mobile-shell";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { InstallBanner } from "@/components/pwa/install-banner";
import { SplashScreen } from "@/components/pwa/splash-screen";
import { PullToRefresh } from "@/components/ui/pull-to-refresh";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="flex h-screen overflow-hidden bg-surface-page">
      <SplashScreen />
      <Sidebar session={session} />
      <MobileShell session={session} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header session={session} />
        <InstallBanner />
        <main id="conteudo-scroll" className="relative flex-1 overflow-y-auto scroller-mobile p-4 sm:p-6 pb-24 lg:pb-6">
          <PullToRefresh scrollTargetId="conteudo-scroll" />
          {children}
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
}
