"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Percent, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dica } from "@/components/ui/dica";
import { toast } from "@/components/ui/avisos";
import { formatarMoeda } from "@/lib/utils";
import {
  calcularRetencoes, motivoRetencaoInvalida, resumoRetencoes, RETENCOES, type ChaveRetencao, type Retencoes,
} from "@/lib/financeiro/retencoes";

type Linha = { marcada: boolean; aliquota: string };

/** O que os serviços da nota dizem (retencoesDosServicos): o que vale, o que só parte retém e as alíquotas */
export interface SugestaoRetencoes { retencoes: Retencoes; parciais: ChaveRetencao[]; aliquotas: Retencoes }
export const SEM_SUGESTAO: SugestaoRetencoes = { retencoes: {}, parciais: [], aliquotas: {} };

interface PropsRetencoes {
  medicaoId: string;
  /** Valor da nota: os serviços, já com o desconto (base das retenções) */
  base: number;
  /** Valor líquido da medição (com produtos, que não entram na nota); ausente = a base */
  liquido?: number;
  gravadas: Retencoes;
  /** Retenções herdadas dos serviços: só pré-marcam enquanto nada foi gravado */
  sugestao: SugestaoRetencoes;
  podeEditar: boolean;
  /** Por que não dá para mudar agora (boleto emitido, conta recebida…) */
  bloqueio: string | null;
}

const DICA: Partial<Record<ChaveRetencao, string>> = {
  iss: "O tomador retém o ISS e recolhe à prefeitura. Use o mesmo da nota.",
};
const virgula = (n: number) => String(n).replace(".", ",");
/** A receber = líquido da medição − retenções (no centavo) */
const aReceber = (liquido: number, retido: number) => (Math.round(liquido * 100) - Math.round(retido * 100)) / 100;
const rotulos = (ks: ChaveRetencao[]) => ks.map((k) => RETENCOES.find((d) => d.chave === k)!.rotulo).join(", ");

/**
 * Editor completo das retenções (as 6 linhas): ISS retido + federais. Mostra bruto, cada retenção e o
 * líquido que a conta a receber/boleto cobra. Nada é gravado sem o usuário salvar. Fica atrás do
 * "Editar" do resumo — é para a exceção (um cliente que retém diferente do cadastro do serviço).
 */
export function MedicaoRetencoes({ medicaoId, base, liquido, gravadas, sugestao, podeEditar, bloqueio, onFechar }: PropsRetencoes & { onFechar?: () => void }) {
  const router = useRouter();
  const nadaGravado = RETENCOES.every((d) => gravadas[d.chave] == null);
  const inicial = () => Object.fromEntries(RETENCOES.map((d) => {
    const g = gravadas[d.chave];
    if (g != null) return [d.chave, { marcada: true, aliquota: virgula(g) }];
    const s = sugestao.retencoes[d.chave];
    if (nadaGravado && s != null) return [d.chave, { marcada: true, aliquota: virgula(s) }];
    const a = sugestao.aliquotas[d.chave];
    return [d.chave, { marcada: false, aliquota: a != null ? virgula(a) : "" }];
  })) as Record<ChaveRetencao, Linha>;
  const [linhas, setLinhas] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const editavel = podeEditar && !bloqueio;
  const alvo: Retencoes = Object.fromEntries(RETENCOES.map((d) => {
    const l = linhas[d.chave];
    return [d.chave, l.marcada ? Number(l.aliquota.replace(",", ".")) : null];
  }));
  const valido = !RETENCOES.some((d) => linhas[d.chave].marcada && !linhas[d.chave].aliquota.trim());
  const detalhe = calcularRetencoes(base, valido ? alvo : Object.fromEntries(RETENCOES.map((d) => [d.chave, linhas[d.chave].marcada && linhas[d.chave].aliquota.trim() ? alvo[d.chave] : null])));
  const mudou = RETENCOES.some((d) => (alvo[d.chave] ?? null) !== (gravadas[d.chave] ?? null));

  const mudar = (k: ChaveRetencao, p: Partial<Linha>) => { setErro(null); setLinhas((x) => ({ ...x, [k]: { ...x[k], ...p } })); };

  async function salvar() {
    const motivo = !valido ? "Informe a alíquota de cada retenção marcada." : motivoRetencaoInvalida(base, alvo);
    if (motivo) { setErro(motivo); return; }
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/medicoes/${medicaoId}/retencoes`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(alvo),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(j.erro ?? "Não foi possível salvar."); return; }
      toast(j.contaReceber ? `Retenções salvas. ${j.contaReceber.numero}: ${formatarMoeda(j.contaReceber.valor)}.` : "Retenções salvas.");
      router.refresh();
      onFechar?.();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div data-retencoes>
      <div className="flex items-start justify-between gap-2 mb-1">
        <h2 className="card-title flex items-center gap-2">
          <Percent className="w-4 h-4 text-primary-600" /> Retenções
          <Dica texto="Marque só o que o cliente retém na fonte. O boleto e a conta a receber saem pelo líquido." />
        </h2>
        {onFechar && (
          <button type="button" onClick={onFechar} className="p-1 -m-1 rounded text-ink-muted hover:text-ink" aria-label="Fechar o editor de retenções" data-fechar-retencoes>
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      <p className="text-xs text-ink-muted mb-3">Vem do cadastro dos serviços. Ajuste só se este cliente retém diferente.</p>

      <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
        <ul className="min-w-0 divide-y divide-surface-border border border-surface-border rounded-lg">
          {RETENCOES.map((d) => {
            const l = linhas[d.chave];
            const valor = detalhe.linhas.find((x) => x.chave === d.chave)?.valor;
            return (
              <li key={d.chave} className="flex items-center gap-2 sm:gap-3 px-3 py-2" data-retencao={d.chave}>
                <label className="flex items-center gap-2 flex-1 min-w-0 text-sm">
                  <input type="checkbox" className="w-4 h-4" checked={l.marcada} disabled={!editavel}
                    onChange={(e) => mudar(d.chave, { marcada: e.target.checked })} data-marcar={d.chave} />
                  <span className="truncate">{d.rotulo}</span>
                  {DICA[d.chave] && <Dica texto={DICA[d.chave]!} />}
                </label>
                <div className="flex items-center gap-1 shrink-0">
                  <input inputMode="decimal" aria-label={`Alíquota de ${d.rotulo} (%)`} placeholder="%"
                    className="input-base w-16 text-right py-1" value={l.aliquota} disabled={!editavel || !l.marcada}
                    onChange={(e) => mudar(d.chave, { aliquota: e.target.value.replace(/[^\d,.]/g, "") })} data-aliquota={d.chave} />
                  <span className="text-xs text-ink-muted">%</span>
                </div>
                <span className="w-20 sm:w-24 shrink-0 text-right text-sm tabular-nums">{l.marcada && valor != null ? `− ${formatarMoeda(valor)}` : "—"}</span>
              </li>
            );
          })}
        </ul>

        <dl className="min-w-0 text-sm space-y-1.5 rounded-lg bg-surface-alt p-3 self-start" data-detalhamento>
          <div className="flex justify-between"><dt className="text-ink-muted">Valor da nota</dt><dd className="tabular-nums" data-bruto>{formatarMoeda(detalhe.bruto)}</dd></div>
          {liquido != null && Math.round(liquido * 100) !== Math.round(base * 100) && (
            <div className="flex justify-between"><dt className="text-ink-muted">Produtos (fora da nota)</dt><dd className="tabular-nums" data-produtos>{formatarMoeda(aReceber(liquido, base))}</dd></div>
          )}
          {detalhe.linhas.map((x) => (
            <div key={x.chave} className="flex justify-between"><dt className="text-ink-muted">{x.rotulo}</dt><dd className="tabular-nums">− {formatarMoeda(x.valor)}</dd></div>
          ))}
          <div className="flex justify-between border-t border-surface-border pt-1.5 font-semibold">
            <dt>Líquido a receber</dt><dd className="tabular-nums" data-liquido>{formatarMoeda(aReceber(liquido ?? base, detalhe.total))}</dd>
          </div>
        </dl>
      </div>

      {sugestao.parciais.length > 0 && (
        <p className="text-xs text-atencao-texto mt-2" data-parciais>Só parte dos serviços retém {rotulos(sugestao.parciais)}. Confira.</p>
      )}
      {bloqueio && <p className="text-xs text-ink-muted mt-2" data-bloqueio-retencoes>{bloqueio}</p>}
      {erro && <p className="text-sm text-atrasado-texto mt-2" role="alert" data-erro-retencoes>{erro}</p>}
      {editavel && (
        <div className="flex justify-end gap-2 mt-3">
          {onFechar && <Button variant="ghost" onClick={onFechar} className="w-full sm:w-auto">Cancelar</Button>}
          <Button onClick={salvar} disabled={salvando || !mudou} data-salvar-retencoes className="w-full sm:w-auto">
            {salvando ? "Salvando…" : "Salvar retenções"}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Resumo discreto do faturamento, numa linha: "Retenções: ISS retido 5% (−R$ 140,00) · Líquido a
 * receber R$ 2.660,00" (sem retenção: só o líquido). O "Editar" abre o editor completo para a exceção
 * e, salvo ou cancelado, volta ao resumo. Mostra o que a conta a receber cobra (o gravado).
 */
export function ResumoRetencoes(props: PropsRetencoes) {
  const [editando, setEditando] = useState(false);
  if (editando) return <MedicaoRetencoes {...props} onFechar={() => setEditando(false)} />;

  const { base, liquido, gravadas, sugestao, podeEditar, bloqueio } = props;
  const d = calcularRetencoes(base, gravadas);
  // Nada gravado mas o cadastro dos serviços pede retenção (medição anterior a isto): avisa sem aplicar
  const naoAplicadas = !d.linhas.length ? RETENCOES.filter((x) => sugestao.retencoes[x.chave] != null).map((x) => x.chave) : [];

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-resumo-retencoes>
      <p className="min-w-0 flex-1 text-ink-muted">
        {d.linhas.length > 0 && <><span data-resumo-linhas>Retenções: {resumoRetencoes(d, formatarMoeda)}</span>{" · "}</>}
        <span className="text-ink">Líquido a receber <strong className="tabular-nums" data-resumo-liquido>{formatarMoeda(aReceber(liquido ?? base, d.total))}</strong></span>
        {naoAplicadas.length > 0 && <span className="block text-xs text-atencao-texto" data-nao-aplicadas>Serviço com {rotulos(naoAplicadas)} não aplicado. Confira em Editar.</span>}
        {sugestao.parciais.length > 0 && <span className="block text-xs text-atencao-texto" data-parciais>Só parte dos serviços retém {rotulos(sugestao.parciais)}. Confira em Editar.</span>}
      </p>
      {podeEditar && !bloqueio && (
        <button type="button" onClick={() => setEditando(true)} className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline shrink-0"
          aria-label="Editar retenções" data-editar-retencoes>
          <Pencil className="w-3.5 h-3.5" /> Editar
        </button>
      )}
      {bloqueio && <Dica texto={bloqueio} rotulo="Retenções travadas" lado="esquerda" />}
    </div>
  );
}
