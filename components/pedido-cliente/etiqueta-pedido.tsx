"use client";

import { useState } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import { ETIQUETA_AGUARDANDO } from "@/lib/pedido-cliente/regra";
import { GavetaPedido, type AlvoPedido } from "@/components/pedido-cliente/gaveta-pedido";
import { GavetaConferir } from "@/components/pedido-cliente/gaveta-conferir";
import { ETIQUETA_CONFERIR, textoUltimoLembrete } from "@/lib/pedido-cliente/lembretes";

export interface PedidoDaLinha {
  /** Esperando o pedido do cliente (a regra: lib/pedido-cliente/regra › aguardandoPedido) */
  aguardando: boolean;
  /** O pedido já informado */
  pedido: { id: string; numero: string } | null;
  /** Liberado sem pedido (com o motivo, para o tooltip) */
  liberadoMotivo?: string | null;
  /** PC-2: o comprador anexou o pedido de compra no portal e ele espera a conferência */
  conferir?: { id: string; numero: string } | null;
  /** PC-2: o último lembrete por e-mail ao contato de compras (ISO) */
  ultimoLembrete?: string | null;
}

/**
 * A ETIQUETA do pedido do cliente — a mesma no cabeçalho da OS e do orçamento e nas linhas das listas:
 *  - "Aguardando pedido" (atenção): 1 clique abre a gaveta para informar;
 *  - "Pedido nº X": 1 clique abre a gaveta com o pedido (corrigir, ver o anexo);
 *  - "Liberado sem pedido": o motivo no tooltip;
 *  - "Pedido recebido — conferir" (PC-2: veio do portal): 1 clique abre a conferência (confirmar ou recusar).
 * O "Último lembrete em …" aparece ao lado no cabeçalho (tamanho md) e no tooltip das listas.
 * Cliente que não exige: nada aparece.
 */
export function EtiquetaPedido({ situacao, alvo, tamanho = "sm" }: { situacao: PedidoDaLinha | null | undefined; alvo: AlvoPedido; tamanho?: "sm" | "md" }) {
  const [aberta, setAberta] = useState(false);
  if (!situacao) return null;
  const { aguardando, pedido, liberadoMotivo, conferir, ultimoLembrete } = situacao;
  if (!aguardando && !pedido && !liberadoMotivo) return null;
  // na linha da lista, o clique na etiqueta não abre a OS
  const abrir = (e: React.MouseEvent) => { e.stopPropagation(); e.preventDefault(); setAberta(true); };
  const lembrete = aguardando ? textoUltimoLembrete(ultimoLembrete ? new Date(ultimoLembrete) : null) : null;
  return (
    <>
      {aguardando && conferir ? (
        <button type="button" onClick={abrir} data-etiqueta-pedido="conferir" title={`O cliente enviou o pedido nº ${conferir.numero} pelo portal: clique para conferir`} className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-acento">
          <StatusPill tom="acento" tamanho={tamanho}>{ETIQUETA_CONFERIR}</StatusPill>
        </button>
      ) : aguardando ? (
        <button type="button" onClick={abrir} data-etiqueta-pedido="aguardando" title={lembrete ? `Clique para informar o pedido do cliente · ${lembrete}` : "Clique para informar o pedido do cliente"} className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-acento">
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
      {lembrete && tamanho === "md" && <span className="text-xs text-ink-muted" data-ultimo-lembrete>{lembrete}</span>}
      {aberta && (aguardando && conferir
        ? <GavetaConferir aberto onFechar={() => setAberta(false)} pedidoId={conferir.id} />
        : <GavetaPedido aberto onFechar={() => setAberta(false)} alvo={alvo} pedidoId={aguardando ? null : pedido?.id ?? null} />)}
    </>
  );
}
