"use client";

import { CadastroPadrao } from "@/components/cadastros/cadastro-padrao";
import { PageHeader } from "@/components/ui/page-header";

/** Cadastro padronizado: campos, colunas, validação e permissões em lib/cadastros/registro.ts. */
export default function CategoriasFinanceirasPage() {
  return (
    <div>
      <PageHeader title="Categorias Financeiras" description="Classifique cobranças e despesas (ex: Contrato Mensal, Serviço Avulso)" backHref="/configuracoes" />
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <CadastroPadrao entidade="categorias-financeiras" />
      </div>
    </div>
  );
}
