import { FileClock, ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";
import { cn } from "@/lib/utils";
import { CLASSE_TOM, type TomStatus } from "@/components/ui/status-pill";
import { situacaoPmoc, dataBR, LABELS_STATUS_PMOC } from "@/lib/pmoc";

/**
 * Selo de status do PMOC, nos tons de status do sistema de design (mesmo formato do selo de garantia):
 * Rascunho (previsto) · Vigente (ok; atenção quando vence em ≤30 dias) · Expirado (atrasado).
 */
export function PmocStatusSelo({ pmoc, detalhe, className }: {
  pmoc: { status: string; dataInicio: Date | string; dataExpiracao: Date | string };
  detalhe?: boolean;
  className?: string;
}) {
  const s = situacaoPmoc(pmoc);
  const tom: TomStatus = s.status === "RASCUNHO" ? "previsto" : s.status === "EXPIRADO" ? "atrasado" : s.vencendo ? "atencao" : "ok";
  const Icone = s.status === "RASCUNHO" ? FileClock : s.status === "EXPIRADO" ? ShieldX : s.vencendo ? ShieldAlert : ShieldCheck;
  const extra = s.status === "EXPIRADO" ? `desde ${dataBR(pmoc.dataExpiracao)}`
    : s.status === "VIGENTE" && s.aIniciar ? `a partir de ${dataBR(pmoc.dataInicio)}`
    : s.status === "VIGENTE" && s.vencendo ? (s.diasParaExpirar === 0 ? "vence hoje" : `vence em ${s.diasParaExpirar} dia${s.diasParaExpirar === 1 ? "" : "s"}`)
    : s.status === "VIGENTE" ? `até ${dataBR(pmoc.dataExpiracao)}` : "não publicado";
  return (
    <span data-status-pmoc={s.status} data-tom={tom} title={`${LABELS_STATUS_PMOC[s.status]} · ${extra}`}
      className={cn("inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap", CLASSE_TOM[tom], className)}>
      <Icone className="w-3 h-3" />
      {LABELS_STATUS_PMOC[s.status]}{detalhe ? ` · ${extra}` : ""}
    </span>
  );
}
