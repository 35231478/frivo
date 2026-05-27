"use client";

import { CrudCadastro } from "@/components/config/crud-cadastro";
import { PageHeader } from "@/components/ui/page-header";
import { formatarMoeda } from "@/lib/utils";

export default function TiposOsPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Tipos de OS" description="Defina os tipos de serviço executados pela empresa" backHref="/configuracoes" />
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <CrudCadastro
          titulo="Tipo de OS"
          apiUrl="/api/tipos-os"
          campos={[
            { key: "nome", label: "Nome", obrigatorio: true, placeholder: "Ex: Manutenção Preventiva" },
            { key: "descricao", label: "Descrição", tipo: "textarea", placeholder: "Descrição do tipo de serviço" },
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
            { key: "descricao", label: "Descrição" },
          ]}
        />
      </div>
    </div>
  );
}
