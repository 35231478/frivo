import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { FornecedoresTela } from "@/components/cadastros/telas/fornecedores";

export const metadata: Metadata = { title: "Fornecedores" };

/** Cadastro padronizado (lib/cadastros): permissões em registro.ts (ver: financeiro; gravar: contas a pagar ou configurações). */
export default function FornecedoresPage() {
  return (
    <div>
      <PageHeader title="Fornecedores" description="Quem a empresa paga: ligado às contas a pagar" backHref="/financeiro/contas-pagar" />
      <div className="bg-white rounded-card border border-surface-border p-4 sm:p-6">
        <FornecedoresTela />
      </div>
    </div>
  );
}
