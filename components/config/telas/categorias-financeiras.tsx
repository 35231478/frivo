"use client";

import { CadastroPadrao } from "@/components/cadastros/cadastro-padrao";
import { PageHeader } from "@/components/ui/page-header";

/** Cadastro padronizado: campos, colunas, validação e permissões em lib/cadastros/registro.ts. */
export function TelaCategoriasFinanceiras() {
  return (
    <div>
      <PageHeader title="Categorias financeiras" description="Classificação de cobranças e despesas" backHref="/configuracoes" />
      <div className="bg-white rounded-card border border-surface-border p-4 sm:p-6">
        <CadastroPadrao entidade="categorias-financeiras" />
      </div>
    </div>
  );
}
