import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { ModelosPrazoTela } from "@/components/cadastros/telas/modelos-prazo";

export const metadata: Metadata = { title: "Prazos e SLA" };

export default function PrazosConfigPage() {
  return (
    <div>
      <PageHeader title="Prazos e SLA" description="Modelos de prazo com etapas, responsáveis e notificações" backHref="/configuracoes" />
      {/* Cadastro padronizado (lib/cadastros): abas Ativos/Inativos/Todos, impacto, ações em massa */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <ModelosPrazoTela />
      </div>
    </div>
  );
}
