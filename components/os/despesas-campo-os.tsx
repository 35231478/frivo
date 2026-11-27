"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { formatarMoeda } from "@/lib/utils";
import { Dica } from "@/components/ui/dica";
import { StatusPill, type TomStatus } from "@/components/ui/status-pill";
import { PAGAMENTO_ESCRITORIO, type StatusDespesa } from "@/lib/tecnico/despesas";
import type { DespesaEscritorio } from "@/lib/execucao/despesas";

const TOM: Record<StatusDespesa, TomStatus> = { PENDENTE: "atencao", APROVADA: "ok", RECUSADA: "atrasado" };
const ROTULO: Record<StatusDespesa, string> = { PENDENTE: "A aprovar", APROVADA: "Aprovada", RECUSADA: "Recusada" };

/** OS › Financeiro: as despesas de campo desta OS. O custo da OS soma só as aprovadas. Some quando não há nenhuma. */
export function DespesasCampoOs({ osId }: { osId: string }) {
  const [lista, setLista] = useState<DespesaEscritorio[] | null>(null);
  useEffect(() => {
    let vivo = true;
    fetch(`/api/ordens/${osId}/despesas-campo`, { cache: "no-store" })
      .then(async (r) => (r.ok ? (await r.json()).despesas : []))
      .then((l) => { if (vivo) setLista(l); }, () => { if (vivo) setLista([]); });
    return () => { vivo = false; };
  }, [osId]);
  if (!lista?.length) return null;
  const custo = Math.round(lista.filter((d) => d.status === "APROVADA").reduce((t, d) => t + d.valor, 0) * 100) / 100;
  return (
    <section className="rounded-card bg-white border border-surface-border p-4 space-y-3" data-secao-despesas-campo>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-ink inline-flex items-center gap-2">
          <ReceiptText className="w-4 h-4 text-ink-muted" /> Despesas de campo
          <Dica rotulo="Despesas de campo" texto="Lançadas pelo técnico no app, com foto do cupom. O custo da OS soma só as aprovadas." />
        </h3>
        <span className="text-sm text-ink-muted">Custo aprovado <span className="font-bold text-ink tabular-nums" data-custo-despesas>{formatarMoeda(custo)}</span></span>
      </div>
      <ul className="divide-y divide-surface-linha">
        {lista.map((d) => (
          <li key={d.id} className="py-2 flex flex-wrap items-center gap-2 text-sm" data-despesa-os={d.status}>
            <span className="font-medium text-ink">{d.categoriaNome}</span>
            <span className="text-ink-muted">{d.colaborador} · {d.data.split("-").reverse().join("/")} · {PAGAMENTO_ESCRITORIO[d.pagamento]}</span>
            <StatusPill tom={TOM[d.status]} tamanho="sm">{ROTULO[d.status]}</StatusPill>
            <span className="ml-auto font-semibold text-ink tabular-nums">{formatarMoeda(d.valor)}</span>
          </li>
        ))}
      </ul>
      <Link href="/financeiro/despesas-campo" className="text-sm text-acento hover:underline">Abrir Despesas de campo</Link>
    </section>
  );
}
