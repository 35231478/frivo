"use client";

import { useState } from "react";
import { ChevronDown, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTecnico } from "@/components/tecnico/contexto";
import type { CartaoTela, OperacaoFila } from "@/lib/tecnico/offline/tipos";
import { situacaoDoCartao } from "@/lib/tecnico/chegada";
import { oQueLevarNoDia, quantidadeComUnidade, resumoDoQueLevar, type MaterialPrevisto } from "@/lib/tecnico/o-que-levar";

/** A lista: o material à esquerda, quantidade e unidade à direita (o que o técnico confere ao carregar). */
function ListaDeMateriais({ itens }: { itens: MaterialPrevisto[] }) {
  return (
    <ul className="divide-y divide-surface-border" data-lista-materiais>
      {itens.map((m) => (
        <li key={m.chave} className="flex items-baseline justify-between gap-3 py-2" data-material={m.descricao}>
          <span className="text-sm text-ink break-words min-w-0">{m.descricao}</span>
          <span className="text-sm font-semibold text-ink tabular-nums whitespace-nowrap" data-material-quantidade>{quantidadeComUnidade(m)}</span>
        </li>
      ))}
    </ul>
  );
}

const quantos = (n: number) => (n === 1 ? "1 material" : `${n} materiais`);

/**
 * "O QUE LEVAR" do dia: a soma dos materiais previstos das OS ainda por fazer, para carregar o veículo
 * uma vez. Fechado por padrão (uma linha com o resumo); abre com um toque. É previsão: nada é baixado
 * do estoque. Funciona sem sinal — usa a lista que já está no aparelho. Some com a opção da empresa
 * desligada (Equipes › App do colaborador) ou quando não há material previsto.
 */
export function OQueLevarDoDia({ cartoes, fila, titulo = "O que levar hoje" }: { cartoes: CartaoTela[]; fila: OperacaoFila[]; titulo?: string }) {
  const { config } = useTecnico();
  const [aberto, setAberto] = useState(false);
  if (!config.oQueLevar) return null;
  // A situação é a que o técnico vê: OS que ele já concluiu no aparelho (ainda a enviar) sai da conta
  const { itens, os } = oQueLevarNoDia(cartoes, (c) => situacaoDoCartao(c, fila).status);
  if (!itens.length) return null;
  return (
    <section className="bg-white rounded-card border border-surface-border overflow-hidden" data-o-que-levar-dia data-materiais={itens.length} data-os={os}>
      <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto} data-abrir-o-que-levar
        className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-surface-alt touch-target">
        <Package className="w-5 h-5 text-primary-700 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-ink">{titulo}</span>
          <span className="block text-xs text-ink-muted" data-resumo-o-que-levar>{resumoDoQueLevar(itens.length, os)}</span>
        </span>
        <ChevronDown className={cn("w-5 h-5 text-ink-subtle shrink-0 transition-transform", aberto && "rotate-180")} aria-hidden />
      </button>
      {aberto && (
        <div className="border-t border-surface-border px-4 pb-3">
          <ListaDeMateriais itens={itens} />
          <p className="text-xs text-ink-muted pt-2" data-nota-previsao>Previsão pelo que foi lançado nas OS. O que for usado é registrado na OS.</p>
        </div>
      )}
    </section>
  );
}

/** A marca no card da OS: quantos materiais ela prevê (o detalhe aparece ao abrir o card). */
export function MarcaDeMateriais({ c }: { c: CartaoTela }) {
  const { config } = useTecnico();
  const n = config.oQueLevar ? c.materiais?.length ?? 0 : 0;
  if (!n) return null;
  return (
    <span className="text-xs font-medium rounded-full px-2 py-0.5 bg-surface-linha text-ink inline-flex items-center gap-1" data-materiais-cartao={n}>
      <Package className="w-3 h-3" aria-hidden /> {quantos(n)}
    </span>
  );
}

/**
 * "O que levar" de UMA OS: os materiais previstos dela. No card do Meu dia aparece aberto (o técnico
 * abriu o card para ler antes de sair); na tela da OS vem recolhido, para não disputar com a execução.
 */
export function OQueLevarDaOs({ c, recolhido, className }: { c: CartaoTela; recolhido?: boolean; className?: string }) {
  const { config } = useTecnico();
  const [aberto, setAberto] = useState(!recolhido);
  const itens = config.oQueLevar ? c.materiais ?? [] : [];
  if (!itens.length) return null;
  const titulo = "text-[11px] font-bold uppercase tracking-wide text-ink-muted";
  return (
    <div className={className} data-o-que-levar-os={c.osId}>
      {recolhido ? (
        <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto} data-abrir-o-que-levar-os
          className="w-full flex items-center justify-between gap-2 text-left touch-target">
          <span className={cn(titulo, "inline-flex items-center gap-1.5")}><Package className="w-3.5 h-3.5" aria-hidden /> O que levar · {quantos(itens.length)}</span>
          <ChevronDown className={cn("w-4 h-4 text-ink-subtle transition-transform", aberto && "rotate-180")} aria-hidden />
        </button>
      ) : <h4 className={titulo}>O que levar</h4>}
      {aberto && <ListaDeMateriais itens={itens} />}
    </div>
  );
}
