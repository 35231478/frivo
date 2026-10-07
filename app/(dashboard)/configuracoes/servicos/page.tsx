"use client";

import { CadastroPadrao } from "@/components/cadastros/cadastro-padrao";
import { PageHeader } from "@/components/ui/page-header";

/** Cadastro padronizado: campos, colunas, validação e permissões em lib/cadastros/registro.ts. */
export default function ServicosPage() {
  return (
    <div>
      <PageHeader title="Serviços" description="Catálogo de serviços prestados pela empresa" backHref="/configuracoes" />
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <CadastroPadrao entidade="servicos" />
      </div>
    </div>
  );
}
