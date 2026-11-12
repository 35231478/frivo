"use client";

import { CrudCadastro } from "@/components/config/crud-cadastro";
import { PageHeader } from "@/components/ui/page-header";

export function TelaTiposOs() {
  return (
    <div>
      <PageHeader title="Tipos de OS" description="Tipos de serviço executados pela empresa" backHref="/configuracoes" />
      <div className="bg-white rounded-card border border-surface-border p-6">
        <CrudCadastro
          titulo="Tipo de OS"
          apiUrl="/api/tipos-os"
          campos={[
            { key: "nome", label: "Nome", obrigatorio: true, placeholder: "Ex: Manutenção Preventiva" },
            { key: "descricao", label: "Descrição", tipo: "textarea", placeholder: "Descrição do tipo de serviço" },
            { key: "cor", label: "Cor", tipo: "color" },
            {
              key: "exigeEquipamento", label: "Exige equipamento para concluir", tipo: "switch", padrao: true,
              ajuda: "Ligado, a OS só é concluída com ao menos um equipamento atendido e o respectivo checklist completo (manutenção, instalação). Desligue para serviços sem equipamento, como visita técnica, vistoria e orçamento.",
            },
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
            {
              key: "exigeEquipamento", label: "Equipamento",
              render: (item: any) => item.exigeEquipamento === false
                ? <span data-exige-equipamento="nao" className="text-xs font-semibold text-atencao-texto bg-atencao-claro border border-atencao/20 px-2 py-0.5 rounded-full">Não exige</span>
                : <span data-exige-equipamento="sim" className="text-xs font-medium text-ink-muted">Exige para concluir</span>,
            },
          ]}
        />
      </div>
    </div>
  );
}
