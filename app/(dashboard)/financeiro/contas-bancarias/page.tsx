import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { ContasBancariasTela } from "@/components/cadastros/telas/contas-bancarias";
import { Building2, ArrowRight } from "lucide-react";
import { hrefSecaoConfig } from "@/lib/navegacao/configuracoes";

export const metadata: Metadata = { title: "Contas Bancárias" };

/** Cadastro padronizado (lib/cadastros): permissões em registro.ts (ler: quem vê o financeiro; gravar: fluxo de caixa ou Configurações › gerenciar). */
export default function ContasBancariasPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <PageHeader title="Contas Bancárias" description="Onde a empresa recebe e paga" backHref="/financeiro" />
      <div className="bg-white rounded-card border border-surface-border p-4 sm:p-6">
        <ContasBancariasTela />
      </div>
      <Link href={hrefSecaoConfig("banco-inter")} data-link-inter
        className="flex items-center gap-2 bg-white rounded-card border border-surface-border px-4 py-3 text-sm text-ink hover:bg-surface-alt transition-colors">
        <Building2 className="w-4 h-4 text-primary-600 shrink-0" aria-hidden="true" />
        <span className="flex-1">Integração Banco Inter (emissão e baixa automática de boletos)</span>
        <ArrowRight className="w-4 h-4 text-ink-muted" aria-hidden="true" />
      </Link>
    </div>
  );
}
