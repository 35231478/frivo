"use client";

import { useState } from "react";
import { AlertTriangle, CalendarClock, RotateCcw, Sparkles, Wallet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn, formatarMoeda, LABELS_FORMA_PAGAMENTO } from "@/lib/utils";
import { lerNumero } from "@/lib/estoque/preco";
import { lerBoleto } from "@/lib/financeiro/boleto";
import { aplicarVencimentos, avisoSomaParcelas, igualANf, MAX_PARCELAS, redistribuir, somaParcelas, type Intervalo, type ParcelaRascunho } from "@/lib/compras/parcelas";
import type { FormaPagamentoConta, PagamentoNfe } from "@/lib/compras/nfe";
import { SeletorCadastro } from "@/components/cadastros/seletor-cadastro";
import { CampoBoleto } from "@/components/financeiro/campo-boleto";
import { InputData } from "@/components/ui/input-data";

/** O que a página manda para a parte financeira da central de lançamento. */
export interface FinanceiroNota {
  categoriaId: string | null;
  centroCustoId: string | null;
  formaPagamento: FormaPagamentoConta | null;
  /** as parcelas do rascunho (ou, sem rascunho, as da NF) */
  parcelas: ParcelaRascunho[];
  /** as que vieram na NF (duplicatas; sem duplicata, à vista) — "voltar ao que veio na NF" */
  parcelasNf: ParcelaRascunho[];
  valorNota: number;
  /** pag/detPag do XML: a forma que o emitente informou */
  pagamentosNf: PagamentoNfe[];
  /** padrões aprendidos do fornecedor */
  padrao: { categoriaId: string | null; centroCustoId: string | null };
  /** "AAAA-MM-DD" de hoje (base quando não há vencimento nenhum) */
  hoje: string;
}

export interface ParcelaUi { duplicata: string | null; vencimento: string; valorTxt: string; boleto: string }
export interface FinanceiroUi { categoriaId: string; centroCustoId: string; forma: string; parcelas: ParcelaUi[] }

const valorBr = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const paraUi = (ps: ParcelaRascunho[]): ParcelaUi[] => ps.map((p) => ({ duplicata: p.duplicata, vencimento: p.vencimento, valorTxt: valorBr(p.valor), boleto: p.boleto ?? "" }));

export function financeiroInicial(f: FinanceiroNota): FinanceiroUi {
  return { categoriaId: f.categoriaId ?? "", centroCustoId: f.centroCustoId ?? "", forma: f.formaPagamento ?? "", parcelas: paraUi(f.parcelas) };
}

/** As parcelas da tela conferidas (valor, vencimento e boleto); o 1º problema vira a mensagem. */
export function parcelasDoUi(ps: ParcelaUi[]): { ok: true; parcelas: ParcelaRascunho[] } | { ok: false; erro: string } {
  const out: ParcelaRascunho[] = [];
  for (const [i, p] of ps.entries()) {
    const valor = lerNumero(p.valorTxt);
    if (valor == null || !(valor > 0)) return { ok: false, erro: `Parcela ${i + 1}: informe um valor maior que zero.` };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.vencimento)) return { ok: false, erro: `Parcela ${i + 1}: informe o vencimento.` };
    let boleto: string | null = null;
    if (p.boleto.replace(/\D/g, "")) {
      const b = lerBoleto(p.boleto);
      if (!b.ok) return { ok: false, erro: `Parcela ${i + 1}: ${b.erro}` };
      boleto = b.boleto.linhaDigitavel;
    }
    out.push({ duplicata: p.duplicata, vencimento: p.vencimento, valor: Math.round(valor * 100) / 100, boleto });
  }
  return { ok: true, parcelas: out };
}

/** Corpo "financeiro" do salvar/lançar: parcelas iguais às da NF e sem boleto = null (seguem a NF). */
export function corpoFinanceiro(v: FinanceiroUi, nota: FinanceiroNota): { ok: true; corpo: Record<string, unknown> } | { ok: false; erro: string } {
  const ps = parcelasDoUi(v.parcelas);
  if (!ps.ok) return ps;
  const comoNaNf = igualANf(ps.parcelas, nota.parcelasNf) && ps.parcelas.every((p) => !p.boleto);
  return {
    ok: true,
    corpo: { categoriaId: v.categoriaId || null, centroCustoId: v.centroCustoId || null, formaPagamento: v.forma || null, parcelas: comoNaNf ? null : ps.parcelas },
  };
}

const INTERVALOS: { valor: string; rotulo: string }[] = [
  { valor: "mensal", rotulo: "todo mês (mesmo dia)" },
  ...[7, 10, 14, 15, 21, 28, 30, 45, 60].map((d) => ({ valor: String(d), rotulo: `a cada ${d} dias` })),
];

/**
 * Parte financeira da central de lançamento: categoria e centro de custo (padrão aprendido do
 * fornecedor), forma de pagamento (do pag/tPag da NF, editável) e as parcelas — nº de parcelas
 * (redistribui o valor da nota), vencimento de cada uma ou de todas de uma vez, valores e o boleto de
 * cada parcela. Soma diferente do valor da nota: só avisa.
 */
export function FinanceiroNotaEditor({ nota, valor, onChange, podeEditar }: {
  nota: FinanceiroNota; valor: FinanceiroUi; onChange: (v: FinanceiroUi) => void; podeEditar: boolean;
}) {
  const [qtdTxt, setQtdTxt] = useState(String(valor.parcelas.length));
  const [primeiro, setPrimeiro] = useState(valor.parcelas[0]?.vencimento ?? nota.hoje);
  const [intervalo, setIntervalo] = useState("mensal");
  const set = (parcial: Partial<FinanceiroUi>) => onChange({ ...valor, ...parcial });
  const setParcela = (i: number, parcial: Partial<ParcelaUi>) => set({ parcelas: valor.parcelas.map((p, k) => (k === i ? { ...p, ...parcial } : p)) });

  const conferidas = parcelasDoUi(valor.parcelas);
  const soma = somaParcelas(valor.parcelas.map((p) => ({ valor: lerNumero(p.valorTxt) ?? 0 })));
  const avisoSoma = avisoSomaParcelas([{ valor: soma }], nota.valorNota);
  const comoNaNf = conferidas.ok && igualANf(conferidas.parcelas, nota.parcelasNf);

  function aplicarQuantidade() {
    const n = Number(qtdTxt);
    if (!Number.isInteger(n) || n < 1 || n > MAX_PARCELAS) { setQtdTxt(String(valor.parcelas.length)); return; }
    if (n === valor.parcelas.length && conferidas.ok && somaParcelas(conferidas.parcelas) === nota.valorNota) return;
    const atuais = conferidas.ok ? conferidas.parcelas : valor.parcelas.map((p) => ({ duplicata: null, vencimento: p.vencimento, valor: 0, boleto: p.boleto || null }));
    set({ parcelas: paraUi(redistribuir(atuais, n, nota.valorNota, nota.hoje)) });
  }
  function aplicarTodos() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(primeiro)) return;
    const iv: Intervalo = intervalo === "mensal" ? "mensal" : Number(intervalo);
    const base = valor.parcelas.map((p) => ({ duplicata: p.duplicata, vencimento: p.vencimento, valor: 0, boleto: null }));
    const novos = aplicarVencimentos(base, primeiro, iv);
    set({ parcelas: valor.parcelas.map((p, i) => ({ ...p, vencimento: novos[i].vencimento })) });
  }
  function voltarNf() {
    set({ parcelas: paraUi(nota.parcelasNf) });
    setQtdTxt(String(nota.parcelasNf.length));
    setPrimeiro(nota.parcelasNf[0]?.vencimento ?? nota.hoje);
  }

  const pagNf = nota.pagamentosNf.length
    ? nota.pagamentosNf.map((p) => `${p.tPag} · ${p.descricao} · ${formatarMoeda(p.valor)}${p.aPrazo ? " (a prazo)" : p.aPrazo === false ? " (à vista)" : ""}`).join("; ")
    : null;
  const padraoBadge = <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-primary-700"><Sparkles className="w-3 h-3" /> padrão deste fornecedor</span>;

  return (
    <div className="card overflow-hidden" data-financeiro-nota>
      <div className="px-4 py-3 border-b border-surface-border bg-surface-alt/40 flex items-center gap-2">
        <Wallet className="w-4 h-4 text-primary-600" />
        <p className="text-sm font-semibold text-ink">Lançamento financeiro <span className="font-normal text-ink-muted">· vira conta a pagar ao confirmar</span></p>
      </div>
      <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <label className="block text-sm">
          <span className="text-xs font-semibold text-ink">Categoria</span>
          <div className="mt-1"><SeletorCadastro entidade="categorias-financeiras" valor={valor.categoriaId} vazio="Sem categoria" disabled={!podeEditar} nome="categoriaId" onChange={(v) => set({ categoriaId: v })} /></div>
          {valor.categoriaId && valor.categoriaId === nota.padrao.categoriaId && <span data-padrao-categoria>{padraoBadge}</span>}
        </label>
        <label className="block text-sm">
          <span className="text-xs font-semibold text-ink">Centro de custo</span>
          <div className="mt-1"><SeletorCadastro entidade="centros-custo" valor={valor.centroCustoId} vazio="Sem centro de custo" disabled={!podeEditar} nome="centroCustoId" onChange={(v) => set({ centroCustoId: v })} /></div>
          {valor.centroCustoId && valor.centroCustoId === nota.padrao.centroCustoId && <span data-padrao-centro>{padraoBadge}</span>}
        </label>
        <label className="block text-sm">
          <span className="text-xs font-semibold text-ink">Forma de pagamento</span>
          <select value={valor.forma} onChange={(e) => set({ forma: e.target.value })} disabled={!podeEditar} name="formaPagamento" data-forma-pagamento
            className="mt-1 w-full bg-white border border-surface-border rounded-lg px-3 py-2 text-sm disabled:bg-surface-alt">
            <option value="">Não informada</option>
            {Object.entries(LABELS_FORMA_PAGAMENTO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <span className="text-[11px] text-ink-muted block mt-0.5" data-pagamento-nf>{pagNf ? `Na NF: ${pagNf}` : "A NF não informa a forma de pagamento."}</span>
        </label>
      </div>

      <div className="border-t border-surface-border p-4 space-y-3" data-parcelas>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <label className="block">
            <span className="block text-xs font-semibold text-ink">Nº de parcelas</span>
            <Input value={qtdTxt} onChange={(e) => setQtdTxt(e.target.value)} onBlur={aplicarQuantidade} disabled={!podeEditar}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); aplicarQuantidade(); } }}
              inputMode="numeric" className="mt-1 w-20 text-right" aria-label="Número de parcelas" name="qtdParcelas" />
          </label>
          {podeEditar && (
            <div className="flex flex-wrap items-end gap-2" data-vencimentos-todos>
              <label className="block">
                <span className="text-xs font-semibold text-ink flex items-center gap-1"><CalendarClock className="w-3.5 h-3.5" /> Todos os vencimentos: 1º em</span>
                <InputData value={primeiro} onChange={(v) => setPrimeiro(v)} className="mt-1 w-40" aria-label="Primeiro vencimento" name="primeiroVencimento" />
              </label>
              <select value={intervalo} onChange={(e) => setIntervalo(e.target.value)} aria-label="Intervalo entre as parcelas" name="intervalo"
                className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm">
                {INTERVALOS.map((i) => <option key={i.valor} value={i.valor}>{i.rotulo}</option>)}
              </select>
              <button type="button" onClick={aplicarTodos} className="text-sm font-semibold text-primary-600 hover:underline px-1 py-2" data-aplicar-vencimentos>Aplicar</button>
            </div>
          )}
          <p className="text-xs text-ink-muted sm:ml-auto text-right tabular-nums" data-soma-parcelas>
            Parcelas <strong className="text-ink">{formatarMoeda(soma)}</strong> · nota <strong className="text-ink">{formatarMoeda(nota.valorNota)}</strong>
          </p>
        </div>

        <ul className="space-y-2">
          {valor.parcelas.map((p, i) => {
            const v = lerNumero(p.valorTxt);
            return (
              <li key={i} className="rounded-lg border border-surface-border px-3 py-2.5 grid grid-cols-1 sm:grid-cols-[5.5rem_10rem_9rem_1fr] gap-x-3 gap-y-2 items-start" data-parcela={i + 1}>
                <div className="text-sm font-semibold text-ink pt-2">
                  {valor.parcelas.length > 1 ? `${i + 1}/${valor.parcelas.length}` : "Única"}
                  {p.duplicata && <span className="block text-[11px] font-normal text-ink-muted">dup. {p.duplicata}</span>}
                </div>
                <label className="block">
                  <span className="sr-only">Vencimento da parcela {i + 1}</span>
                  <InputData value={p.vencimento} onChange={(v) => setParcela(i, { vencimento: v })} disabled={!podeEditar}
                    aria-label={`Vencimento da parcela ${i + 1}`} name={`vencimento-${i + 1}`} />
                </label>
                <label className="block">
                  <span className="sr-only">Valor da parcela {i + 1}</span>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-muted">R$</span>
                    <Input value={p.valorTxt} onChange={(e) => setParcela(i, { valorTxt: e.target.value })} disabled={!podeEditar} inputMode="decimal"
                      className={cn("pl-9 text-right tabular-nums", (v == null || !(v > 0)) && "border-red-400")} aria-label={`Valor da parcela ${i + 1}`} name={`valor-${i + 1}`} />
                  </div>
                </label>
                {podeEditar ? (
                  <CampoBoleto valor={p.boleto} onChange={(t) => setParcela(i, { boleto: t })} compacto name={`boleto-${i + 1}`}
                    rotulo={`Boleto da parcela ${i + 1} (linha digitável ou código de barras)`} valorParcela={v} vencimentoParcela={p.vencimento} />
                ) : (
                  <p className="text-xs text-ink-muted pt-2">{p.boleto ? "Boleto colado" : "Sem boleto"}</p>
                )}
              </li>
            );
          })}
        </ul>

        {avisoSoma && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 flex items-start gap-1.5" data-aviso-soma><AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" /> {avisoSoma}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
          <span data-origem-parcelas>{comoNaNf ? (nota.parcelasNf.some((p) => p.duplicata) ? "Como veio na NF (duplicatas)." : "Sem duplicata na NF: à vista, no valor da nota.") : "Parcelas ajustadas aqui (a NF trazia outras)."}</span>
          {podeEditar && !comoNaNf && (
            <button type="button" onClick={voltarNf} className="inline-flex items-center gap-1 font-semibold text-primary-600 hover:underline" data-voltar-nf>
              <RotateCcw className="w-3.5 h-3.5" /> Voltar ao que veio na NF
            </button>
          )}
        </div>
      </div>
      {!podeEditar && <p className="px-4 pb-3 text-xs text-ink-muted">Categoria, centro de custo, forma e parcelas geram a conta a pagar: só quem tem Financeiro › fluxo de caixa altera.</p>}
    </div>
  );
}
