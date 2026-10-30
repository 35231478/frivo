import Link from "next/link";
import { ExternalLink, Receipt } from "lucide-react";
import { cn, formatarMoeda } from "@/lib/utils";
import { statusVisualReceber } from "@/lib/financeiro-status";
import { hrefContaReceber } from "@/lib/financeiro/conta-receber-gestao";

export interface ContaVinculada { id: string; numero: string; valor: number; status: string; dataVencimento: Date | string | null }

/**
 * "Conta a receber: CR-… (valor · situação)" com Abrir — o outro lado do vínculo da conta com a origem
 * (orçamento, medição, OS). Sem conta, não aparece. `podeAbrir` = permissão de Contas a Receber.
 */
export function ContasReceberVinculadas({ contas, podeAbrir, className }: { contas: ContaVinculada[]; podeAbrir: boolean; className?: string }) {
  if (!contas.length) return null;
  return (
    <div className={cn("space-y-2", className)} data-contas-vinculadas>
      {contas.map((c) => {
        const sv = statusVisualReceber(c.status, c.dataVencimento);
        return (
          <div key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5" data-conta-vinculada={c.id}>
            <Receipt className="w-4 h-4 text-acento shrink-0" aria-hidden />
            <p className="text-sm text-ink">
              Conta a receber: <strong className="font-mono">{c.numero}</strong>{" "}
              <span className="text-ink-muted">({formatarMoeda(c.valor)} · </span>
              <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", sv.classe)}>{sv.label}</span>
              <span className="text-ink-muted">)</span>
            </p>
            {podeAbrir && (
              <Link href={hrefContaReceber(c.id)} className="btn-secondary inline-flex items-center gap-1.5 text-sm sm:ml-auto" data-abrir-conta={c.id}>
                Abrir <ExternalLink className="w-3.5 h-3.5" aria-hidden />
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
