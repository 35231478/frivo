"use client";

import { Tags } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { MOTIVO_MAX } from "@/lib/precos/trava-tabela";

/**
 * Preço de tabela travado — as duas peças de tela comuns ao orçamento e à medição/fatura (a regra mora em
 * lib/precos/trava-tabela): o selo da tabela do cliente, que diz se o preço está travado ou pede motivo, e o campo
 * do motivo, que aparece quando um preço da tabela mudou (ou quando o servidor pediu).
 */
export function SeloTabelaCliente({ nome, podeAlterar }: { nome: string; podeAlterar: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center gap-1.5 bg-success-50 text-success-700 text-xs font-semibold rounded-full px-3 py-1">
        <Tags className="w-3.5 h-3.5" /> Tabela: {nome}
      </span>
      <span className="text-xs text-ink-muted" data-trava-tabela>
        {podeAlterar ? "Mudar o preço da tabela pede motivo" : "Preços da tabela travados"}
      </span>
    </div>
  );
}

export function MotivoPrecoTabela({ alterados, valor, onChange }: { alterados: readonly { descricao: string }[]; valor: string; onChange: (v: string) => void }) {
  return (
    <div className="card-padded" data-motivo-preco-tabela>
      <FormField
        label="Motivo da alteração do preço de tabela" required
        hint={alterados.length ? `Fora da tabela: ${alterados.map((i) => i.descricao).join(", ")}` : "O preço de um item da tabela do cliente mudou."}
      >
        <Input value={valor} onChange={(e) => onChange(e.target.value)} maxLength={MOTIVO_MAX} placeholder="Ex.: desconto negociado com o cliente" />
      </FormField>
    </div>
  );
}
