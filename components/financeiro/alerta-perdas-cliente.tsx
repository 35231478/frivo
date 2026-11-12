"use client";

import Link from "next/link";
import { TrendingDown } from "lucide-react";
import { cn, formatarData, formatarMoeda } from "@/lib/utils";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { Dica } from "@/components/ui/dica";

export interface PerdasCliente { qtd: number; valor: number; ultimaEm: string | Date | null }

/**
 * Inadimplência: o cliente teve cobrança dada como perda nos últimos 12 meses. Só INFORMA (não bloqueia
 * nada) — no cadastro do cliente e antes de atender (Nova OS). Quem tem Contas a Receber abre as cobranças.
 */
export function AlertaPerdasCliente({ clienteId, perdas, className }: { clienteId: string; perdas: PerdasCliente | null | undefined; className?: string }) {
  const { pode } = usePermissoes();
  if (!perdas || perdas.qtd <= 0) return null;
  const verCobrancas = pode("financeiro", "contasReceber");
  return (
    <div role="status" className={cn("bg-atencao-claro border border-atencao/20 text-atencao-texto text-sm rounded-lg px-4 py-3 flex flex-wrap items-center gap-x-2 gap-y-1", className)} data-alerta-perdas={perdas.qtd}>
      <TrendingDown className="w-4 h-4 shrink-0" />
      <span>
        <strong className="font-semibold">Cliente com perda nos últimos 12 meses:</strong>{" "}
        {perdas.qtd} {perdas.qtd === 1 ? "cobrança" : "cobranças"} · {formatarMoeda(perdas.valor)}
        {perdas.ultimaEm ? ` · última em ${formatarData(perdas.ultimaEm)}` : ""}
      </span>
      <Dica rotulo="Perdas do cliente" texto="Cobranças que a empresa deu como perdidas (o cliente não pagou). Só um aviso: dá para atender e cobrar normalmente." />
      {verCobrancas && (
        <Link href={`/financeiro/contas-receber?clienteId=${clienteId}&status=PERDA&periodo=todos`} className="underline hover:no-underline ml-auto" data-ver-perdas-cliente>Ver cobranças</Link>
      )}
    </div>
  );
}
