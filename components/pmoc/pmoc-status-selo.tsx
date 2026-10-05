import { FileClock, ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";
import { cn } from "@/lib/utils";
import { situacaoPmoc, dataBR, LABELS_STATUS_PMOC } from "@/lib/pmoc";

/**
 * Selo de status do PMOC (mesmo visual do selo de garantia do #7):
 * Rascunho (cinza) · Vigente (verde; âmbar quando vence em ≤30 dias) · Expirado (vermelho).
 */
export function PmocStatusSelo({ pmoc, detalhe, className }: {
  pmoc: { status: string; dataInicio: Date | string; dataExpiracao: Date | string };
  detalhe?: boolean;
  className?: string;
}) {
  const s = situacaoPmoc(pmoc);
  const cor = s.status === "RASCUNHO" ? "text-slate-600 bg-slate-100"
    : s.status === "EXPIRADO" ? "text-red-700 bg-red-50"
    : s.vencendo ? "text-amber-700 bg-amber-50" : "text-emerald-700 bg-emerald-50";
  const Icone = s.status === "RASCUNHO" ? FileClock : s.status === "EXPIRADO" ? ShieldX : s.vencendo ? ShieldAlert : ShieldCheck;
  const extra = s.status === "EXPIRADO" ? `desde ${dataBR(pmoc.dataExpiracao)}`
    : s.status === "VIGENTE" && s.aIniciar ? `a partir de ${dataBR(pmoc.dataInicio)}`
    : s.status === "VIGENTE" && s.vencendo ? (s.diasParaExpirar === 0 ? "vence hoje" : `vence em ${s.diasParaExpirar} dia${s.diasParaExpirar === 1 ? "" : "s"}`)
    : s.status === "VIGENTE" ? `até ${dataBR(pmoc.dataExpiracao)}` : "não publicado";
  return (
    <span data-status-pmoc={s.status} title={`${LABELS_STATUS_PMOC[s.status]} · ${extra}`}
      className={cn("inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap", cor, className)}>
      <Icone className="w-3 h-3" />
      {LABELS_STATUS_PMOC[s.status]}{detalhe ? ` · ${extra}` : ""}
    </span>
  );
}
