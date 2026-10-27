"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Plus, ShoppingCart, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/avisos";
import { EditorPedido } from "@/components/compras/editor-pedido";
import { PedidoPainel, StatusPedidoBadge } from "@/components/compras/pedido-painel";
import { cn, formatarData } from "@/lib/utils";
import type { PedidoTela, StatusPedido } from "@/lib/compras/pedido";

interface PedidoLinha {
  id: string; numero: string; status: StatusPedido; statusEm?: string | null; prazoNecessario?: string | null;
  itens: { id: string; descricao: string; quantidade: unknown; unidade: string }[];
}

/**
 * Compras dentro da OS / do orçamento: solicitar material e, na lista, abrir cada pedido ALI MESMO
 * (editar, baixar/enviar o PC ao fornecedor, histórico) — sem trocar de tela.
 */
export function ComprasSecao({ ordemServicoId, orcamentoId }: { ordemServicoId?: string; orcamentoId?: string }) {
  const [pedidos, setPedidos] = useState<PedidoLinha[]>([]);
  const [novo, setNovo] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<Record<string, PedidoTela>>({});
  const [erroAbrir, setErroAbrir] = useState("");

  const query = ordemServicoId ? `ordemServicoId=${ordemServicoId}` : `orcamentoId=${orcamentoId}`;
  function carregar() {
    fetch(`/api/pedidos-compra?${query}`).then((r) => r.json()).then((d) => setPedidos(Array.isArray(d) ? d : [])).catch(() => {});
  }
  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function abrir(id: string) {
    setErroAbrir("");
    if (aberto === id) { setAberto(null); return; }
    setAberto(id);
    const r = await fetch(`/api/pedidos-compra/${id}`, { cache: "no-store" }).catch(() => null);
    const d = r ? await r.json().catch(() => null) : null;
    if (!r?.ok || !d) { setErroAbrir(d?.erro ?? "Não foi possível abrir o pedido."); return; }
    setDetalhe((m) => ({ ...m, [id]: d }));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="section-title flex items-center gap-2"><ShoppingCart className="w-4 h-4 text-primary-600" /> Compras</h3>
        {!novo && (
          <Button variant="outline" size="sm" onClick={() => setNovo(true)} data-solicitar-compra>
            <Plus className="w-4 h-4" /> Solicitar compra de material
          </Button>
        )}
      </div>

      {novo && (
        <div className="border border-primary-200 bg-primary-50/30 rounded-lg p-3 sm:p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-primary-700">Novo pedido de compra</h4>
            <button onClick={() => setNovo(false)} className="text-ink-muted hover:text-ink" aria-label="Fechar"><X className="w-4 h-4" /></button>
          </div>
          <EditorPedido
            ordemServicoId={ordemServicoId}
            orcamentoId={orcamentoId}
            onCancelar={() => setNovo(false)}
            onSalvo={(p) => {
              setNovo(false);
              toast(`Pedido ${p.numero} solicitado.`);
              if (p.whatsappUrl) window.open(p.whatsappUrl, "_blank", "noopener");
              carregar();
            }}
          />
        </div>
      )}

      {pedidos.length === 0 ? (
        <p className="text-sm text-ink-subtle text-center py-6">Nenhum pedido de compra para este registro.</p>
      ) : (
        <div className="divide-y divide-surface-border border border-surface-border rounded-lg">
          {pedidos.map((p) => (
            <div key={p.id}>
              <button type="button" onClick={() => abrir(p.id)} aria-expanded={aberto === p.id}
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-surface-alt transition-colors" data-abrir-pedido={p.id}>
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold text-primary-600">{p.numero}</p>
                  <p className="text-xs text-ink-muted truncate">
                    {p.itens.map((i) => `${i.descricao} (${Number(i.quantidade)} ${i.unidade})`).join(", ")}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {p.prazoNecessario && <span className="text-xs text-ink-muted hidden sm:inline">{formatarData(p.prazoNecessario)}</span>}
                  <StatusPedidoBadge status={p.status} />
                  <ChevronDown className={cn("w-4 h-4 text-ink-muted transition-transform", aberto === p.id && "rotate-180")} />
                </div>
              </button>
              {aberto === p.id && (
                <div className="px-3 pb-4 pt-1 bg-surface-alt/30">
                  {detalhe[p.id] ? (
                    <PedidoPainel inicial={detalhe[p.id]} compacto
                      onMudou={(n) => { setDetalhe((m) => ({ ...m, [n.id]: n })); carregar(); }} />
                  ) : erroAbrir ? (
                    <p className="text-sm text-atrasado-texto py-2">{erroAbrir}</p>
                  ) : (
                    <p className="text-sm text-ink-muted py-2">Carregando…</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
