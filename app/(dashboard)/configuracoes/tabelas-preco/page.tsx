import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { TabelasPrecoClient } from "@/components/config/tabelas-preco-client";

export const metadata: Metadata = { title: "Tabelas de Preços" };

export default function TabelasPrecoPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Tabelas de Preços" description="Defina preços por serviço/produto e vincule a clientes" backHref="/configuracoes" />
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <TabelasPrecoClient />
      </div>
    </div>
  );
}
