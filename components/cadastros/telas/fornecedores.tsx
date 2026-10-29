"use client";

import { CadastroPadrao } from "@/components/cadastros/cadastro-padrao";
import { formatarCpfCnpj } from "@/lib/utils";

/** Fornecedores no padrão: criar/editar/inativar/reativar, CNPJ/CPF único na empresa, impacto antes de inativar. */
export function FornecedoresTela() {
  return (
    <CadastroPadrao
      entidade="fornecedores"
      ajuda="Fornecedores das contas a pagar. Inativar um fornecedor o retira das contas novas; as existentes permanecem vinculadas. O CNPJ/CPF é único na empresa."
      celula={(col, f) => {
        if (col === "documento") return f.documento ? <span className="tabular-nums">{formatarCpfCnpj(f.documento)}</span> : "—";
        if (col === "contato") {
          const partes = [f.telefone, f.email].filter(Boolean);
          return partes.length ? <span className="text-ink-muted">{partes.join(" · ")}</span> : "—";
        }
        if (col === "uso") return f._count?.contasPagar ? `${f._count.contasPagar} conta(s)` : "—";
        return undefined;
      }}
    />
  );
}
