import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { TabelasPrecoTela } from "@/components/cadastros/telas/tabelas-preco";

export const metadata: Metadata = { title: "Tabelas de Preços" };

export default function TabelasPrecoPage() {
  return (
    <div>
      <PageHeader title="Tabelas de Preços" description="Defina preços por serviço/produto e vincule a clientes" backHref="/configuracoes" />
      {/* Cadastro padronizado (lib/cadastros): abas Ativas/Inativas/Todas, impacto, ações em massa */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <TabelasPrecoTela />
      </div>
    </div>
  );
}
