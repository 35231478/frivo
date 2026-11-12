import { cn } from "@/lib/utils";
import { formatarQtd, type Situacao } from "@/lib/estoque/regras";

const COR: Record<Situacao, string> = {
  negativo: "bg-atrasado-claro text-atrasado-texto",
  abaixo: "bg-atencao-claro text-atencao-texto",
  ok: "bg-success-50 text-success-700",
};
const LABEL: Record<Situacao, string> = { negativo: "Negativo", abaixo: "No mínimo ou abaixo", ok: "OK" };

export function SeloSituacao({ situacao }: { situacao: Situacao }) {
  return <span data-situacao={situacao} className={cn("text-[10px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap", COR[situacao])}>{LABEL[situacao]}</span>;
}

/** Saldo em destaque: vermelho se negativo, âmbar se no mínimo ou abaixo */
export function SaldoQtd({ saldo, unidade, situacao, className }: { saldo: number; unidade: string; situacao: Situacao; className?: string }) {
  return (
    <span data-saldo={saldo} className={cn("font-semibold tabular-nums whitespace-nowrap", situacao === "negativo" ? "text-atrasado" : situacao === "abaixo" ? "text-atencao-texto" : "text-ink", className)}>
      {formatarQtd(saldo)} <span className="text-xs font-normal text-ink-muted">{unidade}</span>
    </span>
  );
}
