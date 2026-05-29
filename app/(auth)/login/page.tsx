import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { FrivoLogo } from "@/components/layout/frivo-logo";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden bg-gradient-to-br from-sidebar via-sidebar-800 to-primary-500">
      {/* Decoração ambiente */}
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-primary-500/20 blur-3xl" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-success-500/20 blur-3xl" />

      <div className="relative w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <FrivoLogo size="lg" />
          <p className="text-slate-200 text-sm text-center mt-4">
            Gestão para empresas de climatização e refrigeração
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-elevated p-8 border border-white/10">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-ink">Entrar na sua conta</h2>
            <p className="text-sm text-ink-muted mt-1">Acesse o painel de gestão</p>
          </div>
          <Suspense fallback={<div className="text-sm text-ink-muted">Carregando…</div>}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="text-center text-xs text-slate-300 mt-6">
          © {new Date().getFullYear()} Frivo · by Termofrio
        </p>
      </div>
    </div>
  );
}
