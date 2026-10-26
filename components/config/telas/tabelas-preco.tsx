import { PageHeader } from "@/components/ui/page-header";
import { TabelasPrecoTela } from "@/components/cadastros/telas/tabelas-preco";

export function TelaTabelasPreco() {
  return (
    <div>
      <PageHeader title="Tabelas de Preços" description="Defina preços por serviço/produto e vincule a clientes" backHref="/configuracoes" />
      {/* Cadastro padronizado (lib/cadastros): abas Ativas/Inativas/Todas, impacto, ações em massa */}
      <div className="bg-white rounded-card border border-surface-border p-4 sm:p-6">
        <TabelasPrecoTela />
      </div>
    </div>
  );
}
