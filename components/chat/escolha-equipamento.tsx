"use client";

import { cn } from "@/lib/utils";
import { ROTULO_SEM_EQUIPAMENTO, type EquipamentoFotoTela } from "@/lib/chat/equipamento-foto";

/**
 * CHAT-1.1 — o equipamento da foto em 1 toque: os equipamentos da OS e "Sem equipamento". O mesmo na caixa de escrever
 * (antes de enviar) e no balão (corrigir depois). `valor`: o equipamento marcado; null = "Sem equipamento" marcado;
 * undefined = nada marcado ainda.
 */
export function EscolhaEquipamento({ opcoes, valor, onValor, desabilitado, rotulo = "Equipamento da foto" }: {
  opcoes: EquipamentoFotoTela[];
  valor: string | null | undefined;
  onValor: (equipamentoId: string | null) => void;
  desabilitado?: boolean;
  rotulo?: string;
}) {
  const chip = (ativo: boolean) => cn("shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold max-w-[16rem] truncate touch-target disabled:opacity-50",
    ativo ? "bg-primary-600 text-white border-primary-600" : "bg-white text-ink-muted border-surface-border hover:border-primary-300");
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-0.5" role="radiogroup" aria-label={rotulo} data-escolha-equipamento>
      {opcoes.map((e) => (
        <button key={e.id} type="button" role="radio" aria-checked={valor === e.id} disabled={desabilitado} onClick={() => onValor(e.id)}
          className={chip(valor === e.id)} title={e.detalhe ? `${e.titulo} · ${e.detalhe}` : e.titulo} data-equipamento-opcao={e.id}>
          {e.titulo}
        </button>
      ))}
      <button type="button" role="radio" aria-checked={valor === null} disabled={desabilitado} onClick={() => onValor(null)} className={chip(valor === null)} data-equipamento-opcao="sem">
        {ROTULO_SEM_EQUIPAMENTO}
      </button>
    </div>
  );
}
