"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Calculator, ExternalLink, Plus, Link2, X, Trash2 } from "lucide-react";
import { formatarData, formatarMoeda, cn, LABELS_STATUS_ORCAMENTO, CLASSE_STATUS_ORCAMENTO } from "@/lib/utils";

interface OrcamentoVinculado {
  id: string; // OrcamentoOs.id (relação)
  orcamento: {
    id: string;
    codigo: string;
    nome: string;
    status: string;
    totalGeral: unknown;
    criadoEm: Date | string;
    validadeEm?: Date | string | null;
    tokenPublico: string;
  };
}

interface OrcamentoDisponivel {
  id: string;
  codigo: string;
  nome: string;
  status: string;
  totalGeral: unknown;
}

interface OsOrcamentosVinculadosProps {
  osId: string;
  clienteId: string;
  vinculados: OrcamentoVinculado[];
}

export function OsOrcamentosVinculados({ osId, clienteId, vinculados: iniciais }: OsOrcamentosVinculadosProps) {
  const router = useRouter();
  const [vinculados, setVinculados] = useState(iniciais);
  const [mostraVincular, setMostraVincular] = useState(false);
  const [disponiveis, setDisponiveis] = useState<OrcamentoDisponivel[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState<string | null>(null);

  useEffect(() => {
    if (!mostraVincular) return;
    setCarregando(true);
    fetch(`/api/ordens/${osId}/orcamentos`)
      .then((r) => r.json())
      .then(setDisponiveis)
      .catch(() => {})
      .finally(() => setCarregando(false));
  }, [mostraVincular, osId]);

  async function vincular(orcamentoId: string) {
    setSalvando(orcamentoId);
    try {
      const res = await fetch(`/api/ordens/${osId}/orcamentos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orcamentoId }),
      });
      if (res.ok) {
        setMostraVincular(false);
        router.refresh();
      }
    } finally {
      setSalvando(null);
    }
  }

  async function desvincular(orcamentoId: string, codigo: string) {
    if (!confirm(`Desvincular o orçamento ${codigo} desta OS?`)) return;
    setSalvando(orcamentoId);
    try {
      const res = await fetch(`/api/ordens/${osId}/orcamentos?orcamentoId=${orcamentoId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setVinculados((prev) => prev.filter((v) => v.orcamento.id !== orcamentoId));
        router.refresh();
      }
    } finally {
      setSalvando(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">
          {vinculados.length === 0
            ? "Nenhum orçamento vinculado a esta OS."
            : `${vinculados.length} orçamento(s) vinculado(s).`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostraVincular((v) => !v)}
          >
            <Link2 className="w-4 h-4" /> Vincular existente
          </Button>
          <Link
            href={`/orcamentos/novo?osId=${osId}&clienteId=${clienteId}`}
            className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-sm"
          >
            <Plus className="w-4 h-4" /> Criar novo orçamento
          </Link>
        </div>
      </div>

      {mostraVincular && (
        <div className="border-2 border-primary-200 bg-primary-50/30 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-primary-700">Vincular orçamento existente</h4>
            <button
              type="button"
              onClick={() => setMostraVincular(false)}
              className="text-ink-muted hover:text-ink"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {carregando && <p className="text-sm text-ink-subtle">Carregando...</p>}
          {!carregando && disponiveis.length === 0 && (
            <p className="text-sm text-ink-subtle italic">
              Nenhum orçamento disponível para vincular (este cliente não tem orçamentos em rascunho ou enviados).
            </p>
          )}
          {!carregando && disponiveis.length > 0 && (
            <div className="divide-y divide-surface-border bg-white rounded-lg border border-surface-border max-h-64 overflow-y-auto">
              {disponiveis.map((o) => (
                <div key={o.id} className="flex items-center justify-between p-3 gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-primary-600 text-sm">{o.codigo}</span>
                      <span className={cn("text-[10px]", CLASSE_STATUS_ORCAMENTO[o.status])}>
                        {LABELS_STATUS_ORCAMENTO[o.status]}
                      </span>
                    </div>
                    <p className="text-sm text-ink truncate">{o.nome}</p>
                  </div>
                  <span className="text-sm font-semibold text-ink shrink-0">
                    {formatarMoeda(Number(o.totalGeral))}
                  </span>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => vincular(o.id)}
                    loading={salvando === o.id}
                  >
                    Vincular
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {vinculados.length > 0 && (
        <div className="divide-y divide-surface-border">
          {vinculados.map((v) => (
            <div key={v.id} className="flex items-center justify-between py-3 gap-3">
              <Link
                href={`/orcamentos/${v.orcamento.id}`}
                className="flex items-center gap-3 min-w-0 flex-1 hover:bg-surface-alt px-2 -mx-2 py-1 rounded-lg transition-colors"
              >
                <Calculator className="w-4 h-4 text-primary-600 shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-semibold text-primary-600">{v.orcamento.codigo}</span>
                    <span className={CLASSE_STATUS_ORCAMENTO[v.orcamento.status]}>
                      {LABELS_STATUS_ORCAMENTO[v.orcamento.status]}
                    </span>
                  </div>
                  <p className="text-sm text-ink truncate">{v.orcamento.nome}</p>
                  <p className="text-xs text-ink-subtle">
                    Criado em {formatarData(v.orcamento.criadoEm)}
                    {v.orcamento.validadeEm && ` · Válido até ${formatarData(v.orcamento.validadeEm)}`}
                  </p>
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-ink-muted shrink-0" />
              </Link>
              <span className="text-sm font-semibold text-ink shrink-0">
                {formatarMoeda(Number(v.orcamento.totalGeral))}
              </span>
              <button
                type="button"
                onClick={() => desvincular(v.orcamento.id, v.orcamento.codigo)}
                disabled={salvando === v.orcamento.id}
                className="p-1.5 text-ink-muted hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                title="Desvincular"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
