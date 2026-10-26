import type { Metadata } from "next";
import { Suspense } from "react";
import { FrivoLogo } from "@/components/layout/frivo-logo";
import { DefinirSenhaForm } from "@/components/auth/definir-senha-form";

export const metadata: Metadata = { title: "Definir senha" };

/** Convite de usuário: a pessoa define a própria senha pelo link (assinado, expira, uso único). */
export default function DefinirSenhaPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-surface-page">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8"><FrivoLogo size="lg" variant="dark" /></div>
        <div className="bg-white rounded-card shadow-card p-8 border border-surface-border">
          <Suspense fallback={<div className="text-sm text-ink-muted">Carregando…</div>}>
            <DefinirSenhaForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
