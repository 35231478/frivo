import Link from "next/link";
import { ExternalLink, Receipt } from "lucide-react";
import { Dica } from "@/components/ui/dica";
import { StatusPill, type TomStatus } from "@/components/ui/status-pill";
import { cn, formatarMoeda, LABELS_STATUS_MEDICAO } from "@/lib/utils";
import {
  numeroFatura, percentualDoTotal, ROTULO_STATUS_FATURAMENTO, rotuloParcial, statusFaturamento,
  type FaturamentoOrigem,
} from "@/lib/faturamento/fatura";

export const TOM_STATUS_FATURAMENTO: Record<ReturnType<typeof statusFaturamento>, TomStatus> = { A_FATURAR: "previsto", PARCIAL: "atencao", FATURADO: "ok" };
export const TOM_MEDICAO: Record<string, TomStatus> = { PAGO: "ok", NF_EMITIDA: "acento", BOLETO_GERADO: "acento", PC_RECEBIDO: "previsto", CANCELADA: "atrasado" };

/**
 * Resumo do faturamento da origem (pílula de status + "Faturado X de T · a faturar S"), com o ⓘ do que
 * cada fatura carrega. Peça só de LEITURA, reusada pelo "Faturar" (botao-faturar) e pelas telas de
 * detalhe da venda (fatura/medição e gaveta da conta). A régua (statusFaturamento, saldo) é a do lib.
 */
export function ResumoFaturamento({ f }: { f: FaturamentoOrigem }) {
  const status = statusFaturamento(f);
  return (
    <>
      <StatusPill tom={TOM_STATUS_FATURAMENTO[status]} data-pill-faturamento>{ROTULO_STATUS_FATURAMENTO[status]}</StatusPill>
      <p className="text-sm text-ink flex items-center gap-1" data-resumo-faturamento>
        {status === "A_FATURAR" ? <>A faturar <strong className="tabular-nums">{formatarMoeda(f.saldo)}</strong></>
          : <>Faturado <strong className="tabular-nums">{formatarMoeda(f.faturado)}</strong> de {formatarMoeda(f.total)}{f.saldo > 0 && <> · a faturar <strong className="tabular-nums">{formatarMoeda(f.saldo)}</strong></>}</>}
        <Dica rotulo="Faturamento" lado="direita"
          texto="Cada fatura tem número, nota e conta a receber próprios; retenções saem proporcionais à parte. Cancelar uma fatura devolve o valor dela ao saldo. Parcelado: uma cobrança por mês, cada uma com seu boleto." />
      </p>
    </>
  );
}

/**
 * O histórico das faturas da origem: cada uma com número, a parte (quando parcial), status, NF e valor,
 * com link para a própria fatura. `atualId` realça a fatura que está sendo vista agora (nas telas de
 * detalhe). Peça só de LEITURA — reusada pelo "Faturar" e pelas telas de detalhe da venda.
 */
export function HistoricoFaturas({ f, podeVer = true, atualId }: { f: FaturamentoOrigem; podeVer?: boolean; atualId?: string }) {
  if (f.faturas.length === 0) return null;
  return (
    <ul className="divide-y divide-surface-linha border border-surface-border rounded-lg" data-historico-faturas>
      {f.faturas.map((x) => {
        const parte = x.parcial ? rotuloParcial(x.percentual ?? percentualDoTotal(x.valor, f.total)) : null;
        const atual = x.id === atualId;
        return (
          <li key={x.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm", atual && "bg-primary-50")}
            data-fatura={x.id} data-fatura-parcial={x.parcial ? "1" : undefined} aria-current={atual ? "true" : undefined}>
            <Receipt className="w-4 h-4 text-ink-muted shrink-0" aria-hidden />
            <span className="font-mono text-ink" data-rotulo-fatura>Fatura {numeroFatura(x.numero)}</span>
            {parte && <span className="text-xs text-ink-muted" data-parte>{parte}</span>}
            {atual && <span className="text-[11px] font-medium text-primary-700" data-fatura-atual>Esta venda</span>}
            <StatusPill tom={TOM_MEDICAO[x.status] ?? "previsto"} tamanho="sm">{LABELS_STATUS_MEDICAO[x.status] ?? x.status}</StatusPill>
            {x.nfNumero && <span className="text-xs text-ink-muted" data-nf>NF {x.nfNumero}</span>}
            <span className="ml-auto tabular-nums font-medium text-ink" data-valor-fatura>{formatarMoeda(x.valor)}</span>
            {podeVer && !atual && (
              <Link href={`/financeiro/faturas/${x.id}`} className="inline-flex items-center gap-1 text-xs text-acento hover:underline" data-abrir-fatura={x.id}>
                Abrir <ExternalLink className="w-3 h-3" aria-hidden />
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * "Faturas desta venda" (consolidação P5): o resumo + o histórico das faturas da origem, destacando a
 * atual. Usado nas telas de detalhe da venda (fatura/medição e gaveta da conta). Só aparece quando a
 * venda foi faturada em partes (quem chama decide); é leitura pura, não muda nada.
 */
export function FaturasDaVenda({ faturamento, podeVer = true, atualId }: { faturamento: FaturamentoOrigem; podeVer?: boolean; atualId?: string }) {
  return (
    <div className="space-y-3" data-faturas-da-venda data-status-faturamento={statusFaturamento(faturamento)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ResumoFaturamento f={faturamento} />
      </div>
      <HistoricoFaturas f={faturamento} podeVer={podeVer} atualId={atualId} />
    </div>
  );
}
