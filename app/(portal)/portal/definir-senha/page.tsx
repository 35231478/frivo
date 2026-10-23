import type { Metadata } from "next";
import { Suspense } from "react";
import { FrivoLogo } from "@/components/layout/frivo-logo";
import { PortalDefinirSenhaForm } from "@/components/portal/portal-definir-senha-form";

export const metadata: Metadata = { title: "Portal do Cliente — Criar nova senha" };
export const dynamic = "force-dynamic";

/** UX-5 (Y13): destino do link do e-mail de "Esqueci minha senha" do portal. */
export default function PortalDefinirSenhaPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-sidebar via-sidebar to-primary-600">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <FrivoLogo size="lg" />
          <p className="text-slate-200 text-sm mt-3">Portal do Cliente</p>
        </div>
        <div className="bg-white rounded-2xl shadow-elevated p-6 md:p-8">
          <Suspense fallback={<div className="text-sm text-ink-muted">Carregando…</div>}>
            <PortalDefinirSenhaForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
