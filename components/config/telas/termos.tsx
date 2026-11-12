import { PageHeader } from "@/components/ui/page-header";
import { TermosReferenciaTela } from "@/components/cadastros/telas/termos-referencia";

export function TelaTermos() {
  return (
    <div>
      <PageHeader title="Termos de referência" description="Modelos de termo das propostas de contrato" backHref="/configuracoes" />
      {/* Cadastro padronizado (lib/cadastros): abas Ativos/Inativos/Todos, impacto, ações em massa */}
      <div className="bg-white rounded-card border border-surface-border p-4 sm:p-6">
        <TermosReferenciaTela />
      </div>
    </div>
  );
}
