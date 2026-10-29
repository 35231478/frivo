"use client";

import { CadastroPadrao } from "@/components/cadastros/cadastro-padrao";
import { PageHeader } from "@/components/ui/page-header";

/** Cadastro padronizado: campos, colunas, validação e permissões em lib/cadastros/registro.ts. */
export function TelaProdutos() {
  return (
    <div>
      <PageHeader title="Produtos" description="Peças e materiais usados nos serviços" backHref="/configuracoes" />
      <div className="bg-white rounded-card border border-surface-border p-4 sm:p-6">
        <CadastroPadrao entidade="produtos" />
      </div>
    </div>
  );
}
