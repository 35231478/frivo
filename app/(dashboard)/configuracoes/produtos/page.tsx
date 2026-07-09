"use client";

import { CrudCadastro } from "@/components/config/crud-cadastro";
import { PageHeader } from "@/components/ui/page-header";
import { formatarMoeda } from "@/lib/utils";

export default function ProdutosPage() {
  return (
    <div>
      <PageHeader title="Produtos" description="Catálogo de peças e materiais usados nos serviços" backHref="/configuracoes" />
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <CrudCadastro
          titulo="Produto"
          apiUrl="/api/produtos"
          campos={[
            { key: "nome", label: "Nome", obrigatorio: true, placeholder: "Ex: Gás R410A" },
            { key: "descricao", label: "Descrição", tipo: "textarea" },
            {
              key: "unidade", label: "Unidade", tipo: "select",
              opcoes: [
                { value: "un", label: "Unidade (un)" },
                { value: "kg", label: "Quilograma (kg)" },
                { value: "m", label: "Metro linear (m)" },
                { value: "m2", label: "Metro quadrado (m²)" },
              ],
            },
            { key: "valorPadrao", label: "Valor padrão (R$)", tipo: "number", placeholder: "0,00" },
            { key: "estoqueMinimo", label: "Estoque mínimo", tipo: "number", placeholder: "0" },
          ]}
          colunasLista={[
            { key: "nome", label: "Nome", render: (item: any) => <span className="font-medium">{item.nome}</span> },
            { key: "unidade", label: "Unidade" },
            {
              key: "valorPadrao", label: "Valor padrão",
              render: (item: any) => item.valorPadrao ? formatarMoeda(Number(item.valorPadrao)) : "—",
            },
            {
              key: "estoqueMinimo", label: "Est. mín.",
              render: (item: any) => item.estoqueMinimo ?? "—",
            },
          ]}
        />
      </div>
    </div>
  );
}
