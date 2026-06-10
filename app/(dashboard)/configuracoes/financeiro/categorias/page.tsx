"use client";

import { CrudCadastro } from "@/components/config/crud-cadastro";
import { PageHeader } from "@/components/ui/page-header";

export default function CategoriasFinanceirasPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Categorias Financeiras" description="Classifique cobranças e despesas (ex: Contrato Mensal, Serviço Avulso)" backHref="/configuracoes" />
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <CrudCadastro
          titulo="Categoria"
          apiUrl="/api/categorias-financeiras"
          campos={[
            { key: "nome", label: "Nome", obrigatorio: true, placeholder: "Ex: Contrato Mensal" },
            { key: "cor", label: "Cor", tipo: "color" },
          ]}
          colunasLista={[
            {
              key: "nome", label: "Nome",
              render: (item: any) => (
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: item.cor }} />
                  <span className="font-medium">{item.nome}</span>
                </div>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
