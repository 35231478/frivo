"use client";

import { CadastroPadrao } from "@/components/cadastros/cadastro-padrao";
import { PageHeader } from "@/components/ui/page-header";

/** Cadastro padronizado: campos, colunas, validação e permissões em lib/cadastros/registro.ts. */
export default function CargosPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Cargos" description="Defina os cargos dos colaboradores da empresa" backHref="/configuracoes" />
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <CadastroPadrao entidade="cargos" />
      </div>
    </div>
  );
}
