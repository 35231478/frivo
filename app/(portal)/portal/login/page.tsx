import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FrivoLogo } from "@/components/layout/frivo-logo";
import { PortalLoginForm } from "@/components/portal/portal-login-form";
import { getPortalSession } from "@/lib/auth-portal";

export const metadata: Metadata = { title: "Portal do Cliente — Entrar" };
export const dynamic = "force-dynamic";

export default async function PortalLoginPage() {
  const sessao = await getPortalSession();
  if (sessao?.user) redirect("/portal/dashboard");

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-sidebar via-sidebar to-primary-600">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <FrivoLogo size="lg" />
          <p className="text-slate-200 text-sm mt-3">Portal do Cliente</p>
        </div>
        <div className="bg-white rounded-2xl shadow-elevated p-6 md:p-8">
          <h1 className="text-lg font-bold text-ink mb-1">Acesse sua conta</h1>
          <p className="text-sm text-ink-muted mb-5">Use o e-mail e a senha fornecidos pela empresa.</p>
          <PortalLoginForm />
        </div>
        <p className="text-center text-xs text-slate-300 mt-6">Acompanhe suas ordens de serviço, documentos e financeiro.</p>
      </div>
    </div>
  );
}
