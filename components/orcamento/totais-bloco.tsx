"use client";

import { formatarMoeda, cn } from "@/lib/utils";
import type { TipoDesconto } from "@prisma/client";

interface TotaisBlocoProps {
  totalServicos: number;
  totalProdutos: number;
  desconto: number;
  tipoDesconto: TipoDesconto;
  onDescontoChange: (valor: number) => void;
  onTipoDescontoChange: (tipo: TipoDesconto) => void;
}

export function TotaisBloco({
  totalServicos,
  totalProdutos,
  desconto,
  tipoDesconto,
  onDescontoChange,
  onTipoDescontoChange,
}: TotaisBlocoProps) {
  const totalBruto = totalServicos + totalProdutos;
  const descontoCalculado =
    tipoDesconto === "PERCENTUAL"
      ? Math.min(totalBruto * (desconto / 100), totalBruto)
      : Math.min(desconto, totalBruto);
  const totalGeral = Math.max(0, totalBruto - descontoCalculado);

  return (
    <div className="bg-surface-alt border border-surface-border rounded-xl p-5 space-y-3">
      <Linha label="Subtotal serviços" valor={totalServicos} />
      <Linha label="Subtotal produtos" valor={totalProdutos} />
      <Linha label="Subtotal bruto" valor={totalBruto} bold />

      <div className="flex items-center justify-between gap-3 pt-2 border-t border-surface-border">
        <label className="text-sm font-medium text-ink">Desconto</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.01"
            min="0"
            value={desconto}
            onChange={(e) => onDescontoChange(Number(e.target.value) || 0)}
            className="w-28 bg-white border border-surface-border rounded-lg px-3 py-1.5 text-sm text-right text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10"
          />
          <div className="flex rounded-lg border border-surface-border overflow-hidden bg-white">
            <button
              type="button"
              onClick={() => onTipoDescontoChange("VALOR")}
              className={cn(
                "px-2.5 py-1.5 text-xs font-semibold transition-colors",
                tipoDesconto === "VALOR" ? "bg-primary-500 text-white" : "text-ink-muted hover:bg-surface-alt"
              )}
            >
              R$
            </button>
            <button
              type="button"
              onClick={() => onTipoDescontoChange("PERCENTUAL")}
              className={cn(
                "px-2.5 py-1.5 text-xs font-semibold transition-colors border-l border-surface-border",
                tipoDesconto === "PERCENTUAL" ? "bg-primary-500 text-white" : "text-ink-muted hover:bg-surface-alt"
              )}
            >
              %
            </button>
          </div>
        </div>
      </div>

      {descontoCalculado > 0 && (
        <Linha label="Desconto aplicado" valor={-descontoCalculado} cor="text-red-600" />
      )}

      <div className="pt-3 border-t-2 border-success-500/40 flex items-center justify-between">
        <span className="text-sm font-bold uppercase tracking-wider text-ink-muted">Total geral</span>
        <span className="text-2xl font-bold text-success-700">{formatarMoeda(totalGeral)}</span>
      </div>
    </div>
  );
}

function Linha({ label, valor, bold, cor }: { label: string; valor: number; bold?: boolean; cor?: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={cn("text-ink-muted", bold && "font-semibold text-ink")}>{label}</span>
      <span className={cn("font-mono", bold ? "font-bold text-ink" : "text-ink", cor)}>
        {formatarMoeda(valor)}
      </span>
    </div>
  );
}
