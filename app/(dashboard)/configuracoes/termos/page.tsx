import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { TermosReferenciaTela } from "@/components/cadastros/telas/termos-referencia";

export const metadata: Metadata = { title: "Termos de Referência" };

export default function TermosConfigPage() {
  return (
    <div>
      <PageHeader title="Termos de Referência" description="Modelos de termo usados nas propostas de contrato, com variáveis automáticas" backHref="/configuracoes" />
      {/* Cadastro padronizado (lib/cadastros): abas Ativos/Inativos/Todos, impacto, ações em massa */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <TermosReferenciaTela />
      </div>
    </div>
  );
}
