import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { FrivoLogo } from "@/components/layout/frivo-logo";
import { anoBR } from "@/lib/fuso";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-surface-page">

      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <FrivoLogo size="lg" variant="dark" />
          <p className="text-ink-muted text-sm text-center mt-4">
            Gestão para empresas de climatização e refrigeração
          </p>
        </div>

        <div className="bg-white rounded-card shadow-card p-8 border border-surface-border">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-ink">Entrar na sua conta</h2>
            <p className="text-sm text-ink-muted mt-1">Acesse o painel de gestão</p>
          </div>
          <Suspense fallback={<div className="text-sm text-ink-muted">Carregando…</div>}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="text-center text-xs text-ink-muted mt-6">
          © {anoBR()} Frivo · by Termofrio
        </p>
      </div>
    </div>
  );
}
