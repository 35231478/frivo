import { cn } from "@/lib/utils";
import { formatarQtd, ROTULO_SITUACAO_ESTOQUE, type Situacao } from "@/lib/estoque/regras";

/** Os tons do sistema de design: vermelho para o que falta (sem estoque) ou está errado (negativo), âmbar para repor */
const COR: Record<Situacao, string> = {
  negativo: "bg-atrasado-claro text-atrasado-texto",
  zerado: "bg-atrasado-claro text-atrasado-texto",
  abaixo: "bg-atencao-claro text-atencao-texto",
  ok: "bg-success-50 text-success-700",
};
const COR_SALDO: Record<Situacao, string> = { negativo: "text-atrasado", zerado: "text-atrasado", abaixo: "text-atencao-texto", ok: "text-ink" };

export function SeloSituacao({ situacao }: { situacao: Situacao }) {
  return <span data-situacao={situacao} className={cn("text-[10px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap", COR[situacao])}>{ROTULO_SITUACAO_ESTOQUE[situacao]}</span>;
}

/** Saldo em destaque: vermelho se negativo ou zerado, âmbar se no mínimo ou abaixo */
export function SaldoQtd({ saldo, unidade, situacao, className }: { saldo: number; unidade: string; situacao: Situacao; className?: string }) {
  return (
    <span data-saldo={saldo} className={cn("font-semibold tabular-nums whitespace-nowrap", COR_SALDO[situacao], className)}>
      {formatarQtd(saldo)} <span className="text-xs font-normal text-ink-muted">{unidade}</span>
    </span>
  );
}
