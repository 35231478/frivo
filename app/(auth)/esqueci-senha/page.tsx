import type { Metadata } from "next";
import { Suspense } from "react";
import { FrivoLogo } from "@/components/layout/frivo-logo";
import { EsqueciSenhaForm } from "@/components/auth/esqueci-senha-form";

export const metadata: Metadata = { title: "Esqueci minha senha" };

/** "Esqueci minha senha": pede o e-mail e manda um link (1 hora, uso único) para criar a senha nova. */
export default function EsqueciSenhaPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-surface-page">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8"><FrivoLogo size="lg" variant="dark" /></div>
        <div className="bg-white rounded-card shadow-card p-8 border border-surface-border">
          <Suspense fallback={<div className="text-sm text-ink-muted">Carregando…</div>}>
            <EsqueciSenhaForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
