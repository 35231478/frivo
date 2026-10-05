import { ShieldAlert, ShieldCheck, ShieldX, ShieldOff } from "lucide-react";
import { cn, formatarData } from "@/lib/utils";
import {
  situacaoGarantia, LABELS_SITUACAO_GARANTIA, COR_SITUACAO_GARANTIA,
} from "@/lib/equipamento-garantia";

const ICONE_GARANTIA = { vigente: ShieldCheck, vencendo: ShieldAlert, vencida: ShieldX } as const;

/** Selo Ativo/Inativo. */
export function StatusSelo({ ativo, className }: { ativo: boolean; className?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap",
      ativo ? "text-emerald-700 bg-emerald-50" : "text-slate-500 bg-slate-100",
      className,
    )}>
      <span className={cn("w-1.5 h-1.5 rounded-full", ativo ? "bg-emerald-500" : "bg-slate-400")} />
      {ativo ? "Ativo" : "Inativo"}
    </span>
  );
}

/**
 * Selo da garantia: em garantia / vencendo (≤30d) / vencida.
 * `compacto` mostra só a data de fim (listagem); senão, rótulo + data (perfil).
 */
export function GarantiaSelo({ fim, compacto, className }: { fim: Date | string | null | undefined; compacto?: boolean; className?: string }) {
  const sit = situacaoGarantia(fim);
  if (!fim || !sit) {
    return compacto
      ? <span className="text-xs text-ink-subtle">—</span>
      : (
        <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full text-slate-500 bg-slate-100", className)}>
          <ShieldOff className="w-3 h-3" /> Sem garantia
        </span>
      );
  }
  const Icone = ICONE_GARANTIA[sit];
  return (
    <span
      title={`${LABELS_SITUACAO_GARANTIA[sit]} · até ${formatarData(fim)}`}
      className={cn("inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap", COR_SITUACAO_GARANTIA[sit], className)}
    >
      <Icone className="w-3 h-3" />
      {compacto ? formatarData(fim) : `${LABELS_SITUACAO_GARANTIA[sit]} · ${formatarData(fim)}`}
    </span>
  );
}
