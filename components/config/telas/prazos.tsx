import { PageHeader } from "@/components/ui/page-header";
import { ModelosPrazoTela } from "@/components/cadastros/telas/modelos-prazo";

export function TelaPrazos() {
  return (
    <div>
      <PageHeader title="Etapas com prazo" description="Modelos de etapas com responsável, prazo e aviso, para usar nas OS" backHref="/configuracoes" />
      {/* Cadastro padronizado (lib/cadastros): abas Ativos/Inativos/Todos, impacto, ações em massa */}
      <div className="bg-white rounded-card border border-surface-border p-4 sm:p-6">
        <ModelosPrazoTela />
      </div>
    </div>
  );
}
