"use client";

/**
 * "Orçamento E2" — como a EMPRESA cobra os materiais (Configurações › Orçamento, bloco Materiais). Dois cartões de
 * escolha (o padrão da casa para opções exclusivas): Incluso no serviço | Cobrado à parte. A Peça vai sempre à parte.
 */
import { cn } from "@/lib/utils";
import { COBRANCAS_MATERIAIS, LABEL_COBRANCA, type CobrancaMateriais } from "@/lib/orcamentos/materiais";

const DESCRICAO: Record<CobrancaMateriais, string> = {
  INCLUSO: "Dentro do serviço, sem valor para o cliente.",
  A_PARTE: "Em linha própria, com valor, somando no total.",
};

export function EscolhaCobrancaMateriais({ valor, onChange, disabled }: {
  valor: CobrancaMateriais; onChange: (v: CobrancaMateriais) => void; disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Como os materiais entram na cobrança" className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-cobranca-materiais={valor}>
      {COBRANCAS_MATERIAIS.map((c) => (
        <label key={c} className={cn(
          "flex flex-col gap-1 p-3 border rounded-lg transition-colors",
          disabled ? "cursor-not-allowed opacity-80" : "cursor-pointer",
          valor === c ? "border-acento bg-acento-claro/40" : "border-surface-border hover:border-acento/40",
        )} data-opcao-cobranca={c}>
          <span className="flex items-center gap-2 text-sm font-medium text-ink">
            <input type="radio" name="cobranca-materiais" value={c} checked={valor === c} disabled={disabled} onChange={() => onChange(c)} className="accent-primary-600" />
            {LABEL_COBRANCA[c]}
          </span>
          <span className="text-xs text-ink-muted">{DESCRICAO[c]}</span>
        </label>
      ))}
    </div>
  );
}
