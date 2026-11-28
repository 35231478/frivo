"use client";

import { useState } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import { ETIQUETA_AGUARDANDO } from "@/lib/pedido-cliente/regra";
import { GavetaPedido, type AlvoPedido } from "@/components/pedido-cliente/gaveta-pedido";

export interface PedidoDaLinha {
  /** Esperando o pedido do cliente (a regra: lib/pedido-cliente/regra › aguardandoPedido) */
  aguardando: boolean;
  /** O pedido já informado */
  pedido: { id: string; numero: string } | null;
  /** Liberado sem pedido (com o motivo, para o tooltip) */
  liberadoMotivo?: string | null;
}

/**
 * A ETIQUETA do pedido do cliente — a mesma no cabeçalho da OS e do orçamento e nas linhas das listas:
 *  - "Aguardando pedido" (atenção): 1 clique abre a gaveta para informar;
 *  - "Pedido nº X": 1 clique abre a gaveta com o pedido (corrigir, ver o anexo);
 *  - "Liberado sem pedido": o motivo no tooltip.
 * Cliente que não exige: nada aparece.
 */
export function EtiquetaPedido({ situacao, alvo, tamanho = "sm" }: { situacao: PedidoDaLinha | null | undefined; alvo: AlvoPedido; tamanho?: "sm" | "md" }) {
  const [aberta, setAberta] = useState(false);
  if (!situacao) return null;
  const { aguardando, pedido, liberadoMotivo } = situacao;
  if (!aguardando && !pedido && !liberadoMotivo) return null;
  // na linha da lista, o clique na etiqueta não abre a OS
  const abrir = (e: React.MouseEvent) => { e.stopPropagation(); e.preventDefault(); setAberta(true); };
  return (
    <>
      {aguardando ? (
        <button type="button" onClick={abrir} data-etiqueta-pedido="aguardando" title="Clique para informar o pedido do cliente" className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-acento">
          <StatusPill tom="atencao" tamanho={tamanho}>{ETIQUETA_AGUARDANDO}</StatusPill>
        </button>
      ) : pedido ? (
        <button type="button" onClick={abrir} data-etiqueta-pedido="informado" title="Pedido do cliente: clique para ver ou corrigir" className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-acento">
          <StatusPill tom="previsto" tamanho={tamanho}>Pedido nº {pedido.numero}</StatusPill>
        </button>
      ) : (
        <span title={`Liberado sem pedido do cliente: ${liberadoMotivo}`} data-etiqueta-pedido="liberado">
          <StatusPill tom="previsto" tamanho={tamanho}>Liberado sem pedido</StatusPill>
        </span>
      )}
      {aberta && <GavetaPedido aberto onFechar={() => setAberta(false)} alvo={alvo} pedidoId={aguardando ? null : pedido?.id ?? null} />}
    </>
  );
}
