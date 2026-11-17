import { PageHeader } from "@/components/ui/page-header";
import { ModelosDocumentoTela } from "@/components/cadastros/telas/modelos-documento";

export function TelaModelosDocumento() {
  return (
    <div>
      <PageHeader
        title="Modelos de documento"
        description="Ficha de EPI, termo de responsabilidade, advertência e aditivo"
        backHref="/configuracoes"
      />
      {/* Cadastro padronizado (lib/cadastros): abas Ativos/Inativos/Todos, busca e ações em massa */}
      <div className="bg-white rounded-card border border-surface-border p-4 sm:p-6">
        <ModelosDocumentoTela />
      </div>
    </div>
  );
}
