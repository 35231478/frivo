import type { Metadata } from "next";
import { Suspense } from "react";
import { FrivoLogo } from "@/components/layout/frivo-logo";
import { DefinirSenhaForm } from "@/components/auth/definir-senha-form";

export const metadata: Metadata = { title: "Definir senha" };

/** Convite de usuário: a pessoa define a própria senha pelo link (assinado, expira, uso único). */
export default function DefinirSenhaPage() {
  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden bg-gradient-to-br from-sidebar via-sidebar-800 to-primary-500">
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-primary-500/20 blur-3xl" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-success-500/20 blur-3xl" />
      <div className="relative w-full max-w-md">
        <div className="flex flex-col items-center mb-8"><FrivoLogo size="lg" /></div>
        <div className="bg-white rounded-2xl shadow-elevated p-8 border border-white/10">
          <Suspense fallback={<div className="text-sm text-ink-muted">Carregando…</div>}>
            <DefinirSenhaForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
