"use client";

import { useEffect, useState } from "react";
import { Lightbulb } from "lucide-react";
import { formatarMoeda } from "@/lib/utils";
import { JANELA_MESES, type TipoItem } from "@/lib/orcamentos/sugestoes-itens";

export interface ItemSugerido {
  tipo: TipoItem;
  catalogoId: string | null;
  descricao: string;
  valorUnitario: number;
  vezes: number;
}

const VAZIO: ItemSugerido[] = [];

/**
 * O que o histórico deste cliente sugere para os itens do orçamento (Princípio 9): os serviços e
 * produtos mais usados nele, com o último preço praticado. Sem cliente, ou com histórico fino, vem
 * vazio — e a tela não mostra nada. Nunca preenche sozinha: quem decide é quem clica.
 */
export function useSugestoesItens(clienteId: string, excluirId?: string): ItemSugerido[] {
  const [itens, setItens] = useState<ItemSugerido[]>(VAZIO);
  useEffect(() => {
    if (!clienteId) { setItens(VAZIO); return; }
    let vivo = true;
    const q = `clienteId=${encodeURIComponent(clienteId)}${excluirId ? `&excluir=${encodeURIComponent(excluirId)}` : ""}`;
    fetch(`/api/orcamentos/sugestoes?${q}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      // Sugestão é um extra: falhar (inclusive sem permissão de criar) não atrapalha o orçamento
      .then((d) => { if (vivo) setItens(Array.isArray(d?.itens) ? d.itens : VAZIO); })
      .catch(() => { if (vivo) setItens(VAZIO); });
    return () => { vivo = false; };
  }, [clienteId, excluirId]);
  return itens;
}

/**
 * A faixa de sugestões acima da lista de itens: cada item vira um botão que adiciona a linha com o
 * último preço praticado (sempre editável depois). Some o que já está na lista e o que a pessoa
 * dispensa.
 */
export function SugestoesItens({ tipo, itens, jaNaLista, onUsar }: {
  tipo: TipoItem;
  itens: ItemSugerido[];
  /** O que já está na lista não se sugere de novo */
  jaNaLista: (s: ItemSugerido) => boolean;
  onUsar: (s: ItemSugerido) => void;
}) {
  const [dispensada, setDispensada] = useState(false);
  const alvo = itens.filter((s) => s.tipo === tipo && !jaNaLista(s));
  if (dispensada || alvo.length === 0) return null;
  const rotulo = tipo === "SERVICO" ? "serviços" : "produtos";
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-ink-muted" data-sugestoes-itens={tipo}>
      <Lightbulb className="h-3.5 w-3.5 shrink-0 text-ink-subtle" aria-hidden />
      <span>
        Os {rotulo} que mais entraram nos orçamentos deste cliente nos últimos {JANELA_MESES} meses, com o último preço praticado:
      </span>
      {alvo.map((s) => (
        <button
          key={`${s.tipo}:${s.catalogoId ?? s.descricao}`}
          type="button"
          onClick={() => onUsar(s)}
          data-usar-sugestao-item={s.catalogoId ?? s.descricao}
          title={`${s.vezes} orçamentos nos últimos ${JANELA_MESES} meses`}
          className="inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-white px-2.5 py-1 font-medium text-ink hover:border-primary-500 hover:text-primary-600"
        >
          {s.descricao}
          <span className="tabular-nums text-ink-muted">{formatarMoeda(s.valorUnitario)}</span>
          <span className="text-ink-subtle">· {s.vezes}×</span>
        </button>
      ))}
      <button
        type="button"
        onClick={() => setDispensada(true)}
        data-dispensar-sugestoes={tipo}
        className="text-ink-subtle hover:text-ink-muted"
      >
        Dispensar
      </button>
    </div>
  );
}
