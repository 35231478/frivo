"use client";

import { CadastroPadrao } from "@/components/cadastros/cadastro-padrao";
import { PageHeader } from "@/components/ui/page-header";

/** Cadastro padronizado: campos, colunas, validação e permissões em lib/cadastros/registro.ts. */
export default function ProdutosPage() {
  return (
    <div>
      <PageHeader title="Produtos" description="Catálogo de peças e materiais usados nos serviços" backHref="/configuracoes" />
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <CadastroPadrao entidade="produtos" />
      </div>
    </div>
  );
}
