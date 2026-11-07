"use client";

import { useState } from "react";
import { Boxes, Package, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { Dica } from "@/components/ui/dica";
import { SeletorCadastro } from "@/components/cadastros/seletor-cadastro";
import { PilulaComportamento } from "@/components/estoque/categoria-produto";
import type { ItemCadastro } from "@/lib/cadastros/opcoes";
import { formatarQtd } from "@/lib/estoque/regras";
import {
  ajusteDosMateriais, diferencaDoMaterial, ehPeca, LABEL_ORIGEM, resumoMateriais, valorDaLinha, type MaterialOrcamento,
} from "@/lib/orcamentos/materiais";
import { CampoNumero } from "@/components/orcamento/itens-tabela";
import { cn, formatarMoeda } from "@/lib/utils";

const uid = () => Math.random().toString(36).slice(2);
const sinal = (v: number) => (v > 0 ? `+${formatarMoeda(v)}` : v < 0 ? `−${formatarMoeda(-v)}` : formatarMoeda(0));

export interface LinhaComMateriais {
  id: string;
  descricao: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal?: number | null;
  valorManual?: boolean;
  materiais?: MaterialOrcamento[];
}

/**
 * Estoque E3.3 — painel "Materiais e peças" de uma linha de serviço do orçamento (SÓ na edição interna; o cliente
 * não vê). Snapshot editável: quantidade, valor de venda, tirar (material da composição vira "não usado" e abate o
 * padrão), material avulso. Mostra o detalhamento do ajuste no serviço (por que o total mudou), as peças que vão
 * como linhas de produto e o custo interno (margem). Valor manual: o total digitado na linha vale; "Recalcular"
 * volta a base + ajuste.
 */
export function MateriaisLinha({ item, clienteId, catalogoProdutos, onChange }: {
  item: LinhaComMateriais;
  clienteId: string | null;
  catalogoProdutos: ItemCadastro[];
  onChange: (patch: Partial<LinhaComMateriais>) => void;
}) {
  const [aberto, setAberto] = useState(true);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const ms = item.materiais ?? [];
  const v = valorDaLinha(item);
  const r = resumoMateriais(ms);

  const mudar = (id: string, patch: Partial<MaterialOrcamento>) => onChange({ materiais: ms.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  const tirar = (m: MaterialOrcamento) => {
    // Da composição: fica como "não usado" (quantidade 0) — usar menos abate; avulso some de vez
    if (m.quantidadePadrao > 0) mudar(m.id!, { quantidade: 0 });
    else onChange({ materiais: ms.filter((x) => x.id !== m.id) });
  };
  async function adicionarAvulso(produtoId: string) {
    if (!produtoId) return;
    setCarregando(true); setErro("");
    try {
      const res = await fetch(`/api/orcamentos/materiais-padrao?produtoId=${encodeURIComponent(produtoId)}${clienteId ? `&clienteId=${encodeURIComponent(clienteId)}` : ""}`, { cache: "no-store" });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.material) { setErro(d?.erro ?? "Não foi possível adicionar o material."); return; }
      onChange({ materiais: [...ms, { ...d.material, id: uid() }] });
    } catch { setErro("Erro de conexão."); } finally { setCarregando(false); }
  }

  return (
    <div className="mt-1 mb-1 rounded-lg border border-surface-border bg-surface-page/60" data-materiais-linha data-total-materiais={ms.length}>
      <button type="button" onClick={() => setAberto((a) => !a)} className="w-full flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-left" aria-expanded={aberto} data-abrir-materiais>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
          <Boxes className="w-3.5 h-3.5 text-ink-muted" aria-hidden /> Materiais e peças ({ms.length})
        </span>
        <span className="text-[11px] text-ink-muted tabular-nums">
          Ajuste no serviço: <strong className={cn(r.ajuste > 0 && "text-ink", r.ajuste < 0 && "text-ok-texto")} data-ajuste={r.ajuste}>{sinal(r.ajuste)}</strong>
          {r.quantasPecas > 0 && <> · Peças à parte: <strong data-pecas={r.pecas}>{formatarMoeda(r.pecas)}</strong></>}
        </span>
      </button>
      {aberto && (
        <div className="px-3 pb-3 space-y-2">
          <div className="flex items-center gap-1 text-[11px] text-ink-muted">
            Interno: o cliente vê só a linha do serviço (já ajustada) e as peças como produtos.
            <Dica rotulo="Materiais e peças" texto="Cópia da composição do serviço feita na hora de orçar (mudar o cadastro depois não altera este orçamento). Material INCLUSO ajusta o valor do serviço pela diferença do padrão: (quantidade − padrão) × venda — exceder soma, usar menos abate, avulso entra inteiro. PEÇA (venda à parte) vira uma linha de produto cobrada à parte. O custo é só interno (margem); não entra no preço. Sem baixa de estoque aqui." />
          </div>
          {erro && <p role="alert" className="text-xs text-atrasado-texto">{erro}</p>}
          {ms.length === 0 && <p className="text-xs text-ink-subtle italic">Nenhum material. Adicione um produto avulso abaixo.</p>}
          <div className="space-y-1">
            {ms.map((m) => {
              const peca = ehPeca(m);
              const naoUsado = m.quantidade <= 0 && m.quantidadePadrao > 0;
              const dif = diferencaDoMaterial(m);
              return (
                <div key={m.id} className={cn("grid grid-cols-2 sm:grid-cols-[minmax(0,1.4fr)_auto_5rem_5rem_6.5rem_6.5rem_2rem] gap-x-2 gap-y-1 items-center rounded-md bg-white border border-surface-border px-2 py-1.5 text-xs", naoUsado && "opacity-70")}
                  data-material={m.produtoId ?? ""} data-comportamento-material={m.comportamento} data-nao-usado={naoUsado ? "true" : undefined}>
                  <div className="col-span-2 sm:col-span-1 min-w-0 flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-ink truncate">{m.descricao}</span>
                    <span className="text-[10px] text-ink-subtle">{LABEL_ORIGEM[m.origem]}{m.origem === "KIT" && m.kitNome ? ` ${m.kitNome}` : ""}</span>
                    {naoUsado && <span className="text-[10px] font-semibold bg-surface-alt text-ink-muted px-1.5 py-0.5 rounded">não usado</span>}
                  </div>
                  <PilulaComportamento comportamento={m.comportamento} />
                  <label className="block">
                    <span className="block text-[10px] text-ink-subtle">Padrão</span>
                    <span className="tabular-nums text-ink-muted" data-qtd-padrao={m.quantidadePadrao}>{formatarQtd(m.quantidadePadrao)} {m.unidade}</span>
                  </label>
                  <label className="block">
                    <span className="block text-[10px] text-ink-subtle">Qtd</span>
                    <CampoNumero valor={m.quantidade} onValor={(q) => mudar(m.id!, { quantidade: Math.max(0, q) })} aria-label={`Quantidade de ${m.descricao}`} data-qtd-material className="!bg-white !border-surface-border !py-0.5 text-xs" />
                  </label>
                  <label className="block">
                    <span className="block text-[10px] text-ink-subtle">Venda (un.)</span>
                    <CampoNumero valor={m.valorVendaUnit} casas={2} onValor={(p) => mudar(m.id!, { valorVendaUnit: Math.max(0, p) })} aria-label={`Valor de venda de ${m.descricao}`} data-venda-material className="!bg-white !border-surface-border !py-0.5 text-xs" />
                  </label>
                  <div className="text-right">
                    <span className="block text-[10px] text-ink-subtle">{peca ? "À parte" : "No serviço"}</span>
                    <span className={cn("tabular-nums font-semibold", !peca && dif < 0 && "text-ok-texto")} data-diferenca={peca ? undefined : dif}>
                      {peca ? formatarMoeda(m.quantidade * m.valorVendaUnit) : sinal(dif)}
                    </span>
                    <span className="block text-[10px] text-ink-subtle" data-custo-material>
                      {m.custoUnit == null ? "sem custo" : `custo ${formatarMoeda(m.custoUnit * m.quantidade)}`}
                    </span>
                  </div>
                  <div className="flex justify-end">
                    {naoUsado ? (
                      <button type="button" onClick={() => mudar(m.id!, { quantidade: m.quantidadePadrao })} className="p-1 text-ink-muted hover:text-ink" aria-label={`Voltar a usar ${m.descricao}`} title="Voltar ao padrão"><Undo2 className="w-3.5 h-3.5" /></button>
                    ) : (
                      <button type="button" onClick={() => tirar(m)} className="p-1 text-ink-muted hover:text-atrasado" aria-label={`Tirar ${m.descricao}`} title={m.quantidadePadrao > 0 ? "Não usar (abate o padrão do serviço)" : "Remover"}><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[220px] flex-1 max-w-sm">
              <SeletorCadastro entidade="produtos" itens={catalogoProdutos} valor="" onChange={(v) => void adicionarAvulso(v)} placeholder={carregando ? "Adicionando…" : "+ Material ou peça avulso…"} semCriar disabled={carregando} nome="material-avulso" />
            </div>
          </div>

          <div className="rounded-md bg-white border border-surface-border px-3 py-2 text-xs space-y-1" data-resumo-materiais>
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
              <span className="text-ink-muted">Serviço: base {formatarMoeda(v.valorBase ?? 0)} {sinal(ajusteDosMateriais(ms)).startsWith("−") ? "−" : "+"} materiais {formatarMoeda(Math.abs(r.ajuste))}</span>
              <span className="tabular-nums">= <strong data-total-linha={v.valorTotal}>{formatarMoeda(v.valorManual ? Math.max(0, (v.valorBase ?? 0) + r.ajuste) : v.valorTotal)}</strong></span>
            </div>
            {v.valorManual && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-atencao-texto" data-valor-manual>
                <span>Valor manual na linha: <strong className="tabular-nums">{formatarMoeda(v.valorTotal)}</strong> (o cálculo acima não está sendo usado)</span>
                <button type="button" onClick={() => onChange({ valorManual: false, valorTotal: undefined })} className="inline-flex items-center gap-1 font-semibold text-primary-600 hover:text-primary-700" data-recalcular><RotateCcw className="w-3 h-3" /> Recalcular</button>
              </div>
            )}
            {r.quantasPecas > 0 && <p className="text-ink-muted"><Package className="inline w-3 h-3 mr-1" aria-hidden />{r.quantasPecas} {r.quantasPecas === 1 ? "peça vai" : "peças vão"} como linha de produto, cobrada à parte: <strong className="tabular-nums">{formatarMoeda(r.pecas)}</strong></p>}
            <p className="text-ink-subtle" data-custo-interno={r.custoTotal}>
              Custo interno (último custo de compra): {formatarMoeda(r.custoTotal)}{r.semCusto > 0 ? ` · ${r.semCusto} sem custo` : ""} — não entra no preço.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
