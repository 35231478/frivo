"use client";

import { CrudCadastro } from "@/components/config/crud-cadastro";
import { PageHeader } from "@/components/ui/page-header";

export default function TiposEquipamentoPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Tipos de Equipamento" description="Categorias de equipamentos atendidos pela empresa" backHref="/configuracoes" />
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <CrudCadastro
          titulo="Tipo de equipamento"
          apiUrl="/api/tipos-equipamento"
          campos={[
            { key: "nome", label: "Nome", obrigatorio: true, placeholder: "Ex: Split, Chiller, VRF" },
            { key: "descricao", label: "Descrição", tipo: "textarea", placeholder: "Descrição do tipo de equipamento" },
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
