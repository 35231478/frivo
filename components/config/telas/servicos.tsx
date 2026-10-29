"use client";

import { CadastroPadrao, GrupoDuasColunas } from "@/components/cadastros/cadastro-padrao";
import { SecaoFiscalServico } from "@/components/servicos/secao-fiscal-servico";
import { PageHeader } from "@/components/ui/page-header";
import { GRUPO_NFSE } from "@/lib/cadastros/registro";

const GRUPOS = { [GRUPO_NFSE]: SecaoFiscalServico, "Outros tributos": GrupoDuasColunas };

/** Cadastro padronizado: campos, colunas, validação e permissões em lib/cadastros/registro.ts. */
export function TelaServicos() {
  return (
    <div>
      <PageHeader title="Serviços" description="Serviços prestados pela empresa" backHref="/configuracoes" />
      <div className="bg-white rounded-card border border-surface-border p-4 sm:p-6">
        <CadastroPadrao entidade="servicos" grupos={GRUPOS} />
      </div>
    </div>
  );
}
