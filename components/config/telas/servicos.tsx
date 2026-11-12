"use client";

import { CadastroPadrao, GrupoDuasColunas } from "@/components/cadastros/cadastro-padrao";
import { SecaoFiscalServico } from "@/components/servicos/secao-fiscal-servico";
import { SecaoMateriaisServico } from "@/components/servicos/secao-materiais-servico";
import { PageHeader } from "@/components/ui/page-header";
import { GRUPO_MATERIAIS, GRUPO_NFSE } from "@/lib/cadastros/registro";

const GRUPOS = { [GRUPO_MATERIAIS]: SecaoMateriaisServico, [GRUPO_NFSE]: SecaoFiscalServico, "Outros tributos": GrupoDuasColunas };

/** Cadastro padronizado: campos, colunas, validação e permissões em lib/cadastros/registro.ts. */
export function TelaServicos() {
  return (
    <div>
      <PageHeader title="Serviços" description="Serviços prestados pela empresa" backHref="/configuracoes" />
      <div className="bg-white rounded-card border border-surface-border p-4 sm:p-6">
        <CadastroPadrao
          entidade="servicos" grupos={GRUPOS}
          // E3.2: quantas linhas de materiais padrão (a composição inteira só no formulário)
          celula={(col, s) => { if (col !== "materiais") return undefined; const n = Number(s._count?.materiais ?? 0); return n ? <span data-materiais={n}>{n} {n === 1 ? "linha" : "linhas"}</span> : "—"; }}
        />
      </div>
    </div>
  );
}
