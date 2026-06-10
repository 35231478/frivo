"use client";

import { CrudCadastro } from "@/components/config/crud-cadastro";
import { PageHeader } from "@/components/ui/page-header";

export default function CargosPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Cargos" description="Defina os cargos dos colaboradores da empresa" backHref="/configuracoes" />
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <CrudCadastro
          titulo="Cargo"
          apiUrl="/api/cargos"
          campos={[
            { key: "nome", label: "Nome", obrigatorio: true, placeholder: "Ex: Técnico de Refrigeração" },
            { key: "descricao", label: "Descrição", tipo: "textarea", placeholder: "Atribuições do cargo" },
          ]}
          colunasLista={[
            { key: "nome", label: "Nome", render: (item: any) => <span className="font-medium">{item.nome}</span> },
            { key: "descricao", label: "Descrição" },
          ]}
        />
      </div>
    </div>
  );
}
