import type { Metadata } from "next";
import { FrivoLogo } from "@/components/layout/frivo-logo";
import { PortalEsqueciSenhaForm } from "@/components/portal/portal-esqueci-senha-form";

export const metadata: Metadata = { title: "Portal do Cliente — Esqueci minha senha" };
export const dynamic = "force-dynamic";

/** UX-5 (Y13): cliente travado fora do horário comercial pede uma nova senha sozinho. */
export default function PortalEsqueciSenhaPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-surface-page">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <FrivoLogo size="lg" variant="dark" />
          <p className="text-ink-muted text-sm mt-3">Portal do Cliente</p>
        </div>
        <div className="bg-white rounded-card shadow-card p-6 md:p-8 border border-surface-border">
          <PortalEsqueciSenhaForm />
        </div>
      </div>
    </div>
  );
}
