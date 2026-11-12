"use client";

import { CadastroPadrao } from "@/components/cadastros/cadastro-padrao";
import { PageHeader } from "@/components/ui/page-header";

/** Cadastro padronizado: campos, colunas, validação e permissões em lib/cadastros/registro.ts. */
export function TelaCargos() {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Cargos" description="Cargos dos colaboradores" backHref="/configuracoes" />
      <div className="bg-white rounded-card border border-surface-border p-4 sm:p-6">
        <CadastroPadrao entidade="cargos" />
      </div>
    </div>
  );
}
