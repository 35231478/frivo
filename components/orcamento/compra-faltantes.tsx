"use client";

/**
 * Orçamento, leva C — "Itens sem estoque" na seção Compras do orçamento: o que o estoque não cobre (a mesma regra de
 * disponível da leva B) e o botão "Solicitar compra dos faltantes", que cria UM pedido de compra só com o que falta
 * pedir. Item já pedido aparece "compra solicitada" com o número do pedido (abre ali mesmo, na lista de Compras).
 * Some inteiro quando a empresa não usa Compras ou Estoque, ou quando nada falta. Sem custo nenhum.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dica } from "@/components/ui/dica";
import { toast } from "@/components/ui/avisos";
import { formatarQtd } from "@/lib/estoque/regras";
import type { Faltante } from "@/lib/orcamentos/compra-faltantes";

interface Situacao { disponivel: boolean; podeSolicitar?: boolean; faltantes?: Faltante[] }

export function CompraFaltantes({ orcamentoId, versao = 0, onMudou, onAbrirPedido }: {
  orcamentoId: string;
  /** Muda quando a lista de pedidos da seção muda (criou, cancelou, mudou status): recarrega */
  versao?: number;
  onMudou?: () => void;
  onAbrirPedido?: (pedidoId: string) => void;
}) {
  const [s, setS] = useState<Situacao | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/orcamentos/${orcamentoId}/compra-faltantes`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo) setS(d); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [orcamentoId, versao]);

  if (!s?.disponivel || !s.faltantes?.length) return null;
  const faltantes = s.faltantes;
  const aPedir = faltantes.filter((f) => f.aSolicitar > 0);

  async function solicitar() {
    setEnviando(true);
    try {
      const r = await fetch(`/api/orcamentos/${orcamentoId}/compra-faltantes`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(d.erro ?? "Não foi possível solicitar a compra.", "erro"); return; }
      const numero = d.pedido?.numero ?? "";
      toast(d.acao === "criado" ? `Pedido ${numero} criado com ${d.itens} ${d.itens === 1 ? "item" : "itens"}.`
        : d.acao === "acrescentado" ? `Faltantes acrescentados ao pedido ${numero}.`
          : `Compra já solicitada${numero ? ` em ${numero}` : ""}.`);
      onMudou?.();
    } finally { setEnviando(false); }
  }

  return (
    <section className="rounded-lg border border-atencao/30 bg-atencao-claro/30 p-3 space-y-2" aria-label="Itens sem estoque" data-compra-faltantes>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <AlertTriangle className="w-4 h-4 text-atencao-texto" aria-hidden /> Itens sem estoque
          <Dica rotulo="Itens sem estoque" texto="Produtos e materiais deste orçamento cuja quantidade passa do disponível no estoque (o saldo, já descontadas as reservas das OS). “Solicitar compra dos faltantes” cria um pedido de compra só com o que falta pedir, ligado a este orçamento; clicar de novo não duplica: o que já está pedido sai da conta." />
        </h4>
        {s.podeSolicitar && aPedir.length > 0 && (
          <Button type="button" size="sm" onClick={solicitar} loading={enviando} data-solicitar-faltantes>
            <ShoppingCart className="w-4 h-4" /> Solicitar compra dos faltantes
          </Button>
        )}
      </div>
      <ul className="divide-y divide-surface-border text-sm">
        {faltantes.map((f) => (
          <li key={f.produtoId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-1.5" data-faltante={f.produtoId} data-a-solicitar={f.aSolicitar}>
            <span className="min-w-0 text-ink">
              {f.descricao}{" "}
              <span className="text-xs text-ink-muted tabular-nums whitespace-nowrap">· faltam {formatarQtd(f.falta)} {f.unidade}</span>
            </span>
            <span className="flex flex-wrap items-center gap-1.5 text-xs">
              {f.pedidos.length > 0 && (
                <span className={f.aSolicitar > 0 ? "text-ink-muted" : "inline-flex items-center gap-1 text-ok-texto font-medium"} data-compra-solicitada>
                  {f.aSolicitar > 0 ? `${formatarQtd(f.solicitado)} ${f.unidade} já pedido em` : <><CheckCircle2 className="w-3.5 h-3.5" aria-hidden /> Compra solicitada</>}
                </span>
              )}
              {f.pedidos.map((p) => (
                <button key={p.id} type="button" onClick={() => onAbrirPedido?.(p.id)} className="font-mono font-semibold text-acento hover:underline" data-link-pedido={p.id}>
                  {p.numero}
                </button>
              ))}
              {f.aSolicitar > 0 && <span className="text-atencao-texto tabular-nums" data-falta-pedir>{f.pedidos.length ? "· " : ""}a solicitar {formatarQtd(f.aSolicitar)} {f.unidade}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
