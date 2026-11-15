"use client";

import { useEffect, useState } from "react";
import { Lightbulb } from "lucide-react";
import { formatarMoeda } from "@/lib/utils";
import { formatarQtd } from "@/lib/estoque/regras";
import { JANELA_MESES, motivoDoPreco, type SugestaoCompra } from "@/lib/compras/sugestao-compra";

const VAZIO: SugestaoCompra[] = [];

/**
 * O que o estoque sugere comprar (Princípio 9): os produtos no mínimo ou abaixo, com o último
 * fornecedor e preço de quem tem histórico. Sem permissão de Compras › Gerenciar, ou sem nada em
 * falta, vem vazio — e a tela não mostra nada. Nunca preenche sozinha: quem decide é quem clica.
 */
export function useSugestoesCompra(ativo: boolean): SugestaoCompra[] {
  const [itens, setItens] = useState<SugestaoCompra[]>(VAZIO);
  useEffect(() => {
    if (!ativo) { setItens(VAZIO); return; }
    let vivo = true;
    fetch("/api/compras/sugestoes", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      // Sugestão é um extra: falhar (inclusive sem permissão) não atrapalha o pedido
      .then((d) => { if (vivo) setItens(Array.isArray(d?.itens) ? d.itens : VAZIO); })
      .catch(() => { if (vivo) setItens(VAZIO); });
    return () => { vivo = false; };
  }, [ativo]);
  return itens;
}

/**
 * A faixa de sugestões acima dos itens do pedido avulso: cada produto em falta vira um botão que
 * adiciona a linha já com o que falta para voltar ao mínimo e o último preço praticado (tudo
 * editável depois). Some o que já está na lista e o que a pessoa dispensa.
 */
export function SugestoesCompra({ itens, jaNaLista, onUsar }: {
  itens: SugestaoCompra[];
  /** O produto que já está na lista não se sugere de novo */
  jaNaLista: (s: SugestaoCompra) => boolean;
  onUsar: (s: SugestaoCompra) => void;
}) {
  const [dispensada, setDispensada] = useState(false);
  const alvo = itens.filter((s) => !jaNaLista(s));
  if (dispensada || alvo.length === 0) return null;
  return (
    <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-ink-muted" data-sugestoes-compra>
      <Lightbulb className="h-3.5 w-3.5 shrink-0 text-ink-subtle" aria-hidden />
      <span>O estoque está no mínimo ou abaixo nestes produtos, com o último fornecedor e preço praticado:</span>
      {alvo.map((s) => (
        <button
          key={s.produtoId}
          type="button"
          onClick={() => onUsar(s)}
          data-usar-sugestao-compra={s.produtoId}
          title={s.valorUnitario == null
            ? `Sem compra registrada nos últimos ${JANELA_MESES} meses`
            : `${s.fornecedor ?? "Fornecedor não identificado"} · ${motivoDoPreco(s)}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-white px-2.5 py-1 font-medium text-ink hover:border-primary-500 hover:text-primary-600"
        >
          {s.nome}
          <span className="text-ink-muted">faltam {formatarQtd(s.faltam)} {s.unidade}</span>
          {s.valorUnitario == null
            ? <span className="text-ink-subtle">· compra nova</span>
            : <span className="tabular-nums text-ink-muted">· {formatarMoeda(s.valorUnitario)}</span>}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setDispensada(true)}
        data-dispensar-sugestoes-compra
        className="text-ink-subtle hover:text-ink-muted"
      >
        Dispensar
      </button>
    </div>
  );
}
