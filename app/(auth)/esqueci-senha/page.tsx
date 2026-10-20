import type { Metadata } from "next";
import { Suspense } from "react";
import { FrivoLogo } from "@/components/layout/frivo-logo";
import { EsqueciSenhaForm } from "@/components/auth/esqueci-senha-form";

export const metadata: Metadata = { title: "Esqueci minha senha" };

/** "Esqueci minha senha": pede o e-mail e manda um link (1 hora, uso único) para criar a senha nova. */
export default function EsqueciSenhaPage() {
  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden bg-gradient-to-br from-sidebar via-sidebar-800 to-primary-500">
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-primary-500/20 blur-3xl" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-success-500/20 blur-3xl" />
      <div className="relative w-full max-w-md">
        <div className="flex flex-col items-center mb-8"><FrivoLogo size="lg" /></div>
        <div className="bg-white rounded-2xl shadow-elevated p-8 border border-white/10">
          <Suspense fallback={<div className="text-sm text-ink-muted">Carregando…</div>}>
            <EsqueciSenhaForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
