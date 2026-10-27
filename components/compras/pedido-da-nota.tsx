"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Link2, Lightbulb, ShoppingCart, Unlink, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmar, toast } from "@/components/ui/avisos";
import { cn, formatarMoeda } from "@/lib/utils";
import { CLASSE_STATUS_PEDIDO, LABEL_STATUS_PEDIDO, type StatusPedido } from "@/lib/compras/pedido";

/** Pedido que combina com a NF e por quê (lib/compras/conciliacao avaliarPedido) */
export interface SugestaoPedidoTela { pedidoId: string; numero: string; pontos: number; identico: boolean; motivos: string[] }
/** Pedido já vinculado a esta NF, com o que veio em cada item (lib/compras/conciliacao-server vinculosDaNota) */
export interface VinculoNotaTela {
  pedidoId: string; numero: string; status: string; automatico: boolean;
  itens: { descricao: string; unidade: string; quantidade: number; pedido: number; recebido: number; valorUnitario: number; notaItem: number; criterio: string }[];
}

const qtd = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });

function Motivos({ motivos }: { motivos: string[] }) {
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-ink-muted list-disc pl-4" data-motivos>
      {motivos.map((m) => <li key={m}>{m}</li>)}
    </ul>
  );
}

/**
 * Antes de lançar: "Esta NF parece ser do Pedido X — vincular?". 1 clique escolhe o pedido (o vínculo
 * acontece ao lançar, junto com o estoque e as contas). Idêntico: avisa que vai vincular sozinho.
 * Sem Compras › gerenciar: só mostra (o vínculo é confirmado depois por quem tem).
 */
export function SugestoesPedido({ sugestoes, automaticoId, escolhido, onEscolher, podeEscolher }: {
  sugestoes: SugestaoPedidoTela[]; automaticoId: string | null; escolhido: string;
  onEscolher: (pedidoId: string) => void; podeEscolher: boolean;
}) {
  if (!sugestoes.length) return null;
  return (
    <div className="space-y-2" data-sugestoes-pedido>
      {sugestoes.map((s, idx) => {
        const auto = s.pedidoId === automaticoId && !escolhido;
        const marcado = escolhido === s.pedidoId;
        return (
          <div key={s.pedidoId} data-sugestao-pedido={s.pedidoId}
            className={cn("rounded-lg border px-3 py-2.5 flex flex-col sm:flex-row sm:items-start justify-between gap-2",
              marcado || auto ? "border-primary-300 bg-primary-50" : "border-surface-border bg-white")}>
            <div className="min-w-0 text-sm">
              <p className="text-ink flex items-start gap-1.5">
                <Lightbulb className="w-4 h-4 mt-0.5 shrink-0 text-primary-600" />
                <span>{idx === 0 ? "Esta NF parece ser do " : "Também pode ser do "}<strong>Pedido {s.numero}</strong>{marcado ? "." : " — vincular?"}</span>
              </p>
              <Motivos motivos={s.motivos} />
              {auto && <p className="mt-1 text-xs font-medium text-primary-800 flex items-center gap-1" data-vai-sozinho><Zap className="w-3.5 h-3.5" /> Idêntico ao pedido: vai ser vinculado sozinho ao lançar (dá para desfazer depois).</p>}
              {marcado && <p className="mt-1 text-xs font-medium text-primary-800" data-escolhido>Vai ser vinculado ao lançar a nota.</p>}
            </div>
            {podeEscolher && (
              marcado
                ? <Button variant="ghost" size="sm" className="shrink-0 self-start" onClick={() => onEscolher("")} data-desfazer-escolha>Não vincular</Button>
                : <Button variant="secondary" size="sm" className="shrink-0 self-start" onClick={() => onEscolher(s.pedidoId)} data-escolher-pedido={s.pedidoId}><Link2 className="w-4 h-4" /> Vincular</Button>
            )}
          </div>
        );
      })}
      {!podeEscolher && <p className="text-xs text-ink-muted" data-sem-compras>Quem tem Compras › gerenciar confirma o vínculo com o pedido depois do lançamento.</p>}
    </div>
  );
}

/**
 * Depois de lançar: os pedidos vinculados a esta NF (item a item, com a quantidade) com "Desvincular",
 * e as sugestões que ainda cabem com "Vincular" (1 clique). Sem Compras › gerenciar: só leitura.
 */
export function PedidoDaNota({ notaId, vinculos, sugestoes, podeGerenciar }: {
  notaId: string; vinculos: VinculoNotaTela[]; sugestoes: SugestaoPedidoTela[]; podeGerenciar: boolean;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  if (!vinculos.length && !sugestoes.length) return null;

  async function vincular(s: SugestaoPedidoTela) {
    setOcupado(s.pedidoId);
    try {
      const r = await fetch(`/api/compras/notas/${notaId}/vinculos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pedidoId: s.pedidoId }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(d.erro ?? "Não foi possível vincular.", "erro"); return; }
      toast(d.criados ? `NF vinculada ao pedido ${s.numero}: ${LABEL_STATUS_PEDIDO[d.status as StatusPedido] ?? d.status}.` : `Já estava vinculada ao pedido ${s.numero}.`);
      router.refresh();
    } catch { toast("Erro de conexão.", "erro"); } finally { setOcupado(null); }
  }

  async function desvincular(v: VinculoNotaTela) {
    if (!(await confirmar({
      titulo: `Desvincular do pedido ${v.numero}?`,
      mensagem: `O pedido volta a esperar estes itens, o valor real que veio desta NF sai dos itens e fica registrado no histórico do pedido. A nota em si (estoque e contas a pagar) não muda.`,
      confirmarTexto: "Desvincular", cancelarTexto: "Voltar", perigo: true,
    }))) return;
    setOcupado(v.pedidoId);
    try {
      const r = await fetch(`/api/compras/notas/${notaId}/vinculos?pedidoId=${encodeURIComponent(v.pedidoId)}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(d.erro ?? "Não foi possível desvincular.", "erro"); return; }
      toast(`NF desvinculada do pedido ${v.numero}.`);
      router.refresh();
    } catch { toast("Erro de conexão.", "erro"); } finally { setOcupado(null); }
  }

  return (
    <div className="card overflow-hidden" data-pedido-da-nota>
      <p className="px-4 py-3 border-b border-surface-border text-sm font-semibold flex items-center gap-2"><ShoppingCart className="w-4 h-4 text-primary-600" /> Pedido de compra</p>
      {vinculos.length > 0 && (
        <ul className="divide-y divide-surface-border">
          {vinculos.map((v) => (
            <li key={v.pedidoId} className="px-4 py-3 flex flex-col sm:flex-row sm:items-start justify-between gap-2" data-vinculo-pedido={v.pedidoId}>
              <div className="min-w-0 text-sm">
                <p className="flex flex-wrap items-center gap-1.5">
                  <Link href={`/compras/pedidos/${v.pedidoId}`} className="font-semibold text-primary-700 hover:underline">Pedido {v.numero}</Link>
                  <span className={CLASSE_STATUS_PEDIDO[v.status as StatusPedido] ?? "badge-base"} data-status-vinculo={v.status}>{LABEL_STATUS_PEDIDO[v.status as StatusPedido] ?? v.status}</span>
                  {v.automatico && <span className="badge-base bg-primary-50 text-primary-700" data-vinculo-automatico>vinculada sozinha</span>}
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">
                  {v.itens.map((it) => (
                    <li key={`${it.notaItem}-${it.descricao}`} data-vinculo-item>
                      Item {it.notaItem} → <span className="text-ink">{it.descricao}</span>: {qtd(it.quantidade)} {it.unidade} × {formatarMoeda(it.valorUnitario)}
                      {" "}<span className={it.recebido >= it.pedido ? "text-success-700" : "text-atencao-texto"}>(recebido {qtd(it.recebido)} de {qtd(it.pedido)})</span>
                    </li>
                  ))}
                </ul>
              </div>
              {podeGerenciar && (
                <Button variant="ghost" size="sm" className="shrink-0 self-start" onClick={() => desvincular(v)} disabled={!!ocupado} loading={ocupado === v.pedidoId} data-desvincular-pedido={v.pedidoId}>
                  <Unlink className="w-4 h-4" /> Desvincular
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {sugestoes.length > 0 && (
        <div className={cn("px-4 py-3 space-y-2", vinculos.length > 0 && "border-t border-surface-border")} data-sugestoes-pos>
          {sugestoes.map((s) => (
            <div key={s.pedidoId} className="flex flex-col sm:flex-row sm:items-start justify-between gap-2" data-sugestao-pedido={s.pedidoId}>
              <div className="min-w-0 text-sm">
                <p className="text-ink flex items-start gap-1.5"><Lightbulb className="w-4 h-4 mt-0.5 shrink-0 text-primary-600" />
                  <span>{vinculos.length ? "O restante desta NF parece ser do " : "Esta NF parece ser do "}<strong>Pedido {s.numero}</strong> — vincular?</span></p>
                <Motivos motivos={s.motivos} />
              </div>
              {podeGerenciar && (
                <Button variant="secondary" size="sm" className="shrink-0 self-start" onClick={() => vincular(s)} disabled={!!ocupado} loading={ocupado === s.pedidoId} data-vincular-pedido={s.pedidoId}>
                  <Link2 className="w-4 h-4" /> Vincular
                </Button>
              )}
            </div>
          ))}
          {!podeGerenciar && <p className="text-xs text-ink-muted">Só quem tem Compras › gerenciar vincula a nota ao pedido.</p>}
        </div>
      )}
    </div>
  );
}
