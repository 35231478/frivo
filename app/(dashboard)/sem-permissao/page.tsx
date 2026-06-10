import type { Metadata } from "next";
import Link from "next/link";
import { Lock, LayoutDashboard } from "lucide-react";

export const metadata: Metadata = { title: "Sem permissão" };

export default function SemPermissaoPage() {
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-6">
      <div className="w-20 h-20 rounded-2xl bg-red-50 flex items-center justify-center mb-6">
        <Lock className="w-9 h-9 text-red-500" />
      </div>
      <h1 className="text-2xl font-bold text-ink">Você não tem permissão para acessar esta área</h1>
      <p className="text-sm text-ink-muted mt-2 max-w-md">
        Seu perfil de acesso não inclui esta seção do sistema. Entre em contato com o
        administrador do sistema para solicitar acesso.
      </p>
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 mt-6 bg-primary-500 hover:bg-primary-600 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors"
      >
        <LayoutDashboard className="w-4 h-4" /> Voltar ao Dashboard
      </Link>
    </div>
  );
}
