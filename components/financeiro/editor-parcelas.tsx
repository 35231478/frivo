"use client";

import { useEffect, useState } from "react";
import { cn, formatarMoeda } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { InputData } from "@/components/ui/input-data";
import { FormField, FormGrid } from "@/components/ui/form-field";
import {
  MAX_PARCELAS, MIN_PARCELAS, dividirEmParcelas, motivoPlanoInvalido, somaParcelas, type ParcelaPlano,
} from "@/lib/financeiro/parcelas";
import { chaveHojeBR } from "@/lib/fuso";

/** Quantidades oferecidas no seletor (o máximo aceito pelo servidor é MAX_PARCELAS) */
const QTDS = Array.from({ length: 24 - MIN_PARCELAS + 1 }, (_, i) => i + MIN_PARCELAS);

/**
 * Editor do parcelamento (Parcelar, Nova cobrança): quantidade + 1º vencimento geram as parcelas
 * mensais iguais (os centavos que sobram vão na 1ª); cada linha ainda pode ter vencimento e valor
 * ajustados. Mostra a soma × o total e o motivo quando o plano não vale (a mesma regra do servidor).
 */
export function EditorParcelas({ total, primeiroVencimento, onChange }: {
  total: number;
  /** Sugestão para o 1º vencimento (aaaa-mm-dd) — padrão: daqui a 30 dias */
  primeiroVencimento?: string | null;
  /** Plano atual e se ele vale (motivo null) */
  onChange: (plano: ParcelaPlano[], motivo: string | null) => void;
}) {
  const [qtd, setQtd] = useState(MIN_PARCELAS + 1);
  const [primeiro, setPrimeiro] = useState(primeiroVencimento || chaveHojeBR(30));
  const [plano, setPlano] = useState<ParcelaPlano[]>(() => dividirEmParcelas(total, MIN_PARCELAS + 1, primeiroVencimento || chaveHojeBR(30)));

  // Mudou quantidade, 1º vencimento ou o total: refaz as parcelas iguais
  useEffect(() => {
    if (total > 0 && primeiro) setPlano(dividirEmParcelas(total, qtd, primeiro));
  }, [total, qtd, primeiro]);

  const motivo = total > 0 ? motivoPlanoInvalido(total, plano) : "Informe o valor antes de parcelar.";
  useEffect(() => { onChange(plano, motivo); }, [plano, motivo]); // eslint-disable-line react-hooks/exhaustive-deps

  const mudar = (i: number, campo: keyof ParcelaPlano, v: string) =>
    setPlano((p) => p.map((x, k) => (k === i ? { ...x, [campo]: campo === "valor" ? Number(v) : v } : x)));
  const soma = somaParcelas(plano);
  const bate = Math.round(soma * 100) === Math.round(total * 100);

  return (
    <div className="space-y-3" data-editor-parcelas>
      <FormGrid>
        <FormField label="Parcelas">
          <Select value={String(qtd)} onChange={(e) => setQtd(Number(e.target.value))} aria-label="Quantidade de parcelas" data-qtd-parcelas>
            {QTDS.map((n) => <option key={n} value={n}>{n}× de {formatarMoeda(dividirEmParcelas(total, n, primeiro)[n - 1]?.valor ?? 0)}</option>)}
          </Select>
        </FormField>
        <FormField label="1º vencimento" dica="As outras vencem no mesmo dia dos meses seguintes. Ajuste cada uma abaixo, se precisar.">
          <InputData value={primeiro} onChange={setPrimeiro} aria-label="Primeiro vencimento" />
        </FormField>
      </FormGrid>
      <div className="border border-surface-border rounded-lg overflow-hidden">
        <table className="w-full table-fixed text-sm" data-tabela-parcelas>
          <thead className="bg-surface-alt text-[11px] uppercase tracking-wider text-ink-muted">
            <tr>
              <th scope="col" className="text-left font-semibold px-2 sm:px-3 py-1.5 w-11 sm:w-14">Nº</th>
              <th scope="col" className="text-left font-semibold px-2 sm:px-3 py-1.5">Vencimento</th>
              {/* Valor estreito no celular: a data (dd/mm/aaaa) precisa caber inteira */}
              <th scope="col" className="text-right font-semibold px-2 sm:px-3 py-1.5 w-[6.75rem] sm:w-[9rem]">Valor (R$)</th>
            </tr>
          </thead>
          <tbody>
            {plano.map((p, i) => (
              <tr key={i} className="border-t border-surface-border" data-parcela-plano={i + 1}>
                <td className="px-2 sm:px-3 py-1 text-ink-muted tabular-nums">{i + 1}/{plano.length}</td>
                <td className="px-2 sm:px-3 py-1"><InputData value={p.vencimento} onChange={(v) => mudar(i, "vencimento", v)} aria-label={`Vencimento da parcela ${i + 1}`} /></td>
                <td className="px-2 sm:px-3 py-1">
                  <Input type="number" step="0.01" min="0.01" value={String(p.valor)} onChange={(e) => mudar(i, "valor", e.target.value)}
                    className="text-right tabular-nums" aria-label={`Valor da parcela ${i + 1}`} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-surface-border bg-surface-alt/60">
              <td colSpan={2} className="px-3 py-1.5 text-xs text-ink-muted">Soma das parcelas</td>
              <td className={cn("px-3 py-1.5 text-right font-semibold tabular-nums", bate ? "text-ink" : "text-atrasado-texto")} data-soma-parcelas>
                {formatarMoeda(soma)} <span className="font-normal text-ink-muted">de {formatarMoeda(total)}</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {motivo && plano.length > 0 && <p role="alert" className="text-xs text-atrasado-texto" data-motivo-plano>{motivo}</p>}
      <p className="sr-only">Até {MAX_PARCELAS} parcelas.</p>
    </div>
  );
}
