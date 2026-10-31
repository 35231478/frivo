"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ReceiptText } from "lucide-react";
import { Dica } from "@/components/ui/dica";
import { formatarMoeda } from "@/lib/utils";
import { resumoRetencoes, type LinhaRetencao } from "@/lib/financeiro/retencoes";

export interface PreviaCobranca {
  servico: { id: string; nome: string; codigo: string | null; ativo: boolean };
  bruto: number;
  linhas: LinhaRetencao[];
  total: number;
  liquido: number;
  pendenciasNfse: string[];
}

/**
 * Prévia da mensalidade com o serviço padrão do contrato: "Cobrança R$ X − retenções R$ Y = cobrado
 * R$ Z" (a mesma conta do servidor: /api/contratos/previa-cobranca) e o que falta no serviço para a
 * NFS-e. Sem serviço: o aviso de que a nota fica pendente (comportamento de hoje).
 */
export function PreviaCobrancaContrato({ servicoId, valor }: { servicoId: string | null | undefined; valor: number | null | undefined }) {
  const [previa, setPrevia] = useState<PreviaCobranca | null>(null);
  const [erro, setErro] = useState("");
  const temValor = typeof valor === "number" && Number.isFinite(valor) && valor > 0;

  useEffect(() => {
    setErro("");
    if (!servicoId || !temValor) { setPrevia(null); return; }
    let vivo = true;
    const t = setTimeout(() => {
      fetch(`/api/contratos/previa-cobranca?servicoId=${encodeURIComponent(servicoId)}&valor=${valor}`)
        .then(async (r) => {
          const d = await r.json().catch(() => ({}));
          if (!vivo) return;
          if (!r.ok) { setPrevia(null); setErro(d.erro ?? "Não foi possível calcular a prévia."); return; }
          setPrevia(d);
        })
        .catch(() => { if (vivo) { setPrevia(null); setErro("Não foi possível calcular a prévia."); } });
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [servicoId, valor, temValor]);

  if (!servicoId) {
    return (
      <div data-sem-servico className="flex items-start gap-2 rounded-lg border border-atencao/20 bg-atencao-claro px-3 py-2 text-xs text-atencao-texto">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>Sem serviço padrão, a nota da mensalidade fica pendente até alguém escolher o serviço.</span>
        <Dica rotulo="Serviço padrão" lado="esquerda" texto="Escolha o serviço do catálogo que vai na nota da mensalidade. Com ele, a NFS-e do contrato sai sem pendência e as retenções vêm do cadastro do serviço. É isso que libera a emissão automática." />
      </div>
    );
  }
  if (!temValor) return <p data-previa-sem-valor className="text-xs text-ink-muted">Informe o valor mensal para ver quanto entra de fato.</p>;
  if (erro) return <p data-previa-erro className="text-xs text-atrasado-texto">{erro}</p>;
  if (!previa) return <p className="text-xs text-ink-muted">Calculando…</p>;

  const comRetencao = previa.total > 0;
  return (
    <div data-previa-cobranca className="space-y-1.5 rounded-lg border border-surface-border bg-surface-alt/50 px-3 py-2">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-ink tabular-nums">
        <ReceiptText className="h-3.5 w-3.5 text-ink-muted" />
        {comRetencao ? (
          <>
            <span>Cobrança <strong>{formatarMoeda(previa.bruto)}</strong></span>{" "}
            <span>− retenções <strong>{formatarMoeda(previa.total)}</strong></span>{" "}
            <span>= cobrado <strong className="text-ok-texto" data-liquido>{formatarMoeda(previa.liquido)}</strong></span>
          </>
        ) : (
          <span>Sem retenção: cobrado <strong className="text-ok-texto" data-liquido>{formatarMoeda(previa.liquido)}</strong></span>
        )}
        <Dica rotulo="Valor cobrado" lado="esquerda" texto="É o que vai na conta a receber e no boleto de cada mês: o valor mensal menos as retenções marcadas no cadastro do serviço (a mesma regra do Faturar). Os impostos retidos o cliente paga direto ao governo." />
      </p>
      {comRetencao && <p data-previa-retencoes className="text-xs text-ink-muted">{resumoRetencoes(previa, formatarMoeda)}</p>}
      {!previa.servico.ativo && <p data-servico-inativo className="text-xs text-atencao-texto">Este serviço está inativo. Ele continua valendo neste contrato.</p>}
      {previa.pendenciasNfse.length > 0 && (
        <p data-previa-pendencias className="flex flex-wrap items-center gap-1 text-xs text-atencao-texto">
          <AlertTriangle className="h-3.5 w-3.5" />
          Para a nota sair, falta no serviço: {previa.pendenciasNfse.join(" e ")}.
          <a href="/configuracoes/servicos" className="font-medium underline">Abrir Serviços</a>
        </p>
      )}
    </div>
  );
}
