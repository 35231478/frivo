import { PageHeader } from "@/components/ui/page-header";
import { ModelosPrazoTela } from "@/components/cadastros/telas/modelos-prazo";

export function TelaPrazos() {
  return (
    <div>
      <PageHeader title="Prazos e SLA" description="Etapas, responsáveis e notificações das OS" backHref="/configuracoes" />
      {/* Cadastro padronizado (lib/cadastros): abas Ativos/Inativos/Todos, impacto, ações em massa */}
      <div className="bg-white rounded-card border border-surface-border p-4 sm:p-6">
        <ModelosPrazoTela />
      </div>
    </div>
  );
}
