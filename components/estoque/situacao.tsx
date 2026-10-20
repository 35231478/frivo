import { cn } from "@/lib/utils";
import { formatarQtd, type Situacao } from "@/lib/estoque/regras";

const COR: Record<Situacao, string> = {
  negativo: "bg-red-50 text-red-700",
  abaixo: "bg-amber-50 text-amber-700",
  ok: "bg-success-50 text-success-700",
};
const LABEL: Record<Situacao, string> = { negativo: "Negativo", abaixo: "No mínimo ou abaixo", ok: "OK" };

export function SeloSituacao({ situacao }: { situacao: Situacao }) {
  return <span data-situacao={situacao} className={cn("text-[10px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap", COR[situacao])}>{LABEL[situacao]}</span>;
}

/** Saldo em destaque: vermelho se negativo, âmbar se no mínimo ou abaixo */
export function SaldoQtd({ saldo, unidade, situacao, className }: { saldo: number; unidade: string; situacao: Situacao; className?: string }) {
  return (
    <span data-saldo={saldo} className={cn("font-semibold tabular-nums whitespace-nowrap", situacao === "negativo" ? "text-red-600" : situacao === "abaixo" ? "text-amber-600" : "text-ink", className)}>
      {formatarQtd(saldo)} <span className="text-xs font-normal text-ink-muted">{unidade}</span>
    </span>
  );
}
