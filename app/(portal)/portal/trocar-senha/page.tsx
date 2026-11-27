import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FrivoLogo } from "@/components/layout/frivo-logo";
import { PortalTrocarSenhaForm } from "@/components/portal/portal-trocar-senha-form";
import { getPortalSession } from "@/lib/auth-portal";
import { ROTA_INICIO_PORTAL } from "@/lib/portal/senha-provisoria";

export const metadata: Metadata = { title: "Portal do cliente — Criar senha" };
export const dynamic = "force-dynamic";

/**
 * 1º acesso ao portal com a senha provisória: só esta tela abre até o contato criar a própria senha.
 * Sem sessão, o login; sem troca pendente, o portal (nunca volta para cá: sem ciclo).
 */
export default async function PortalTrocarSenhaPage() {
  const sessao = await getPortalSession({ comTroca: true });
  if (!sessao?.user) redirect("/portal/login");
  if (!sessao.user.trocarSenha) redirect(ROTA_INICIO_PORTAL);
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-surface-page">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <FrivoLogo size="lg" variant="dark" />
          <p className="text-ink-muted text-sm mt-3">Portal do cliente</p>
        </div>
        <div className="bg-white rounded-card shadow-card p-6 md:p-8 border border-surface-border">
          <PortalTrocarSenhaForm nome={sessao.user.name ?? ""} email={sessao.user.email ?? ""} />
        </div>
      </div>
    </div>
  );
}
