"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  LABELS_STATUS_CONTRATO, COR_STATUS_CONTRATO, LABELS_TIPO_CONTRATO,
  formatarMoeda, formatarData, cn,
} from "@/lib/utils";
import { Plus, FileSignature, MapPin, ExternalLink, Loader2 } from "lucide-react";

interface ContratoCard {
  id: string;
  numero: string;
  tipo: string;
  status: string;
  valorMensal: number | null;
  dataInicio: string | null;
  dataFim: string | null;
  locais: string[];
}

// Ativos primeiro, depois os demais.
const ORDEM_STATUS: Record<string, number> = {
  ATIVO: 0, EM_RENOVACAO: 1, AGUARDANDO_ASSINATURA: 2, SUSPENSO: 3, VENCIDO: 4, ENCERRADO: 5,
};

function badgeVencimento(dataFim: string | null): { txt: string; cls: string } {
  if (!dataFim) return { txt: "Vigência indeterminada", cls: "bg-slate-100 text-slate-600" };
  const fim = new Date(dataFim);
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const dias = Math.round((fim.getTime() - hoje.getTime()) / 86400000);
  if (dias < 0) return { txt: `Vencido há ${Math.abs(dias)} dias`, cls: "bg-red-50 text-red-700" };
  if (dias <= 30) return { txt: `Vence em ${dias} dias`, cls: "bg-amber-50 text-amber-700" };
  return { txt: `Vence em ${dias} dias`, cls: "bg-success-50 text-success-700" };
}

export function ClienteContratos({ clienteId }: { clienteId: string }) {
  const [contratos, setContratos] = useState<ContratoCard[] | null>(null);

  useEffect(() => {
    fetch(`/api/clientes/${clienteId}/contratos`)
      .then((r) => r.json())
      .then((d) => setContratos(Array.isArray(d) ? d : []))
      .catch(() => setContratos([]));
  }, [clienteId]);

  const ordenados = (contratos ?? []).slice().sort((a, b) => {
    const sa = ORDEM_STATUS[a.status] ?? 9;
    const sb = ORDEM_STATUS[b.status] ?? 9;
    if (sa !== sb) return sa - sb;
    if (a.dataFim && b.dataFim) return new Date(a.dataFim).getTime() - new Date(b.dataFim).getTime();
    if (a.dataFim) return -1;
    if (b.dataFim) return 1;
    return a.numero.localeCompare(b.numero);
  });

  const novoHref = `/contratos/novo?clienteId=${clienteId}`;

  if (contratos === null) {
    return <div className="flex items-center gap-2 text-sm text-ink-muted py-6"><Loader2 className="w-4 h-4 animate-spin" /> Carregando contratos…</div>;
  }

  if (ordenados.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <FileSignature className="w-8 h-8 text-ink-subtle" />
        <p className="text-sm text-ink-muted">Nenhum contrato cadastrado para este cliente.</p>
        <Link href={novoHref} className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm">
          <Plus className="w-4 h-4" /> Novo contrato
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Link href={novoHref} className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm">
          <Plus className="w-4 h-4" /> Novo contrato
        </Link>
      </div>

      <div className="space-y-3">
        {ordenados.map((c) => {
          const bv = badgeVencimento(c.dataFim);
          const vigencia = `${c.dataInicio ? formatarData(c.dataInicio) : "—"} → ${c.dataFim ? formatarData(c.dataFim) : "Indeterminado"}`;
          return (
            <div key={c.id} className="border border-surface-border rounded-xl p-4 hover:border-primary-300 transition-colors bg-white">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-ink">{c.numero}</span>
                    <span className="text-xs text-ink-muted">{LABELS_TIPO_CONTRATO[c.tipo] ?? c.tipo}</span>
                    <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", COR_STATUS_CONTRATO[c.status] ?? "bg-slate-100 text-slate-600")}>
                      {LABELS_STATUS_CONTRATO[c.status] ?? c.status}
                    </span>
                    <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", bv.cls)}>{bv.txt}</span>
                  </div>
                  <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-xs text-ink-muted">
                    <span className="font-medium text-ink">{c.valorMensal != null ? `${formatarMoeda(c.valorMensal)}/mês` : "Sem valor mensal"}</span>
                    <span>{vigencia}</span>
                  </div>
                  {c.locais.length > 0 && (
                    <p className="flex items-start gap-1.5 text-xs text-ink-subtle">
                      <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{c.locais.join(" · ")}</span>
                    </p>
                  )}
                </div>
                <Link href={`/contratos/${c.id}/editar`} className="shrink-0">
                  <Button type="button" variant="secondary" className="text-xs h-8 px-3">
                    <ExternalLink className="w-3.5 h-3.5" /> Ver contrato
                  </Button>
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
