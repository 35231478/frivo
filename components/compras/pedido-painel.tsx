"use client";

import { useState } from "react";
import Link from "next/link";
import { Ban, Download, History, Mail, MessageCircle, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmar, toast } from "@/components/ui/avisos";
import { abaPendente } from "@/components/orcamento/envio-proposta";
import { EditorPedido } from "@/components/compras/editor-pedido";
import { cn, formatarData, formatarDataHora, formatarMoeda } from "@/lib/utils";
import {
  CLASSE_STATUS_PEDIDO, LABEL_STATUS_PEDIDO, ROTULO_EVENTO_PEDIDO, faltaParaEnviar, pedidoEncerrado, totalEstimadoPedido,
  type CanalEnvioPedido, type PedidoTela,
} from "@/lib/compras/pedido";

const qtd = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",");

/** "OS 2026-0012" / "Orçamento ORC-2026-0003" / "Avulso — Reposição de estoque", com link */
export function OrigemPedido({ pedido, className }: { pedido: Pick<PedidoTela, "origem" | "motivo">; className?: string }) {
  const { origem } = pedido;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-1", className)} data-origem-pedido={origem.tipo}>
      {origem.os ? (
        <>OS <Link href={`/ordens/${origem.os.id}?aba=materiais`} className="font-mono font-semibold text-acento hover:underline">{origem.os.numero}</Link>
          {origem.orcamento && <span className="text-ink-muted"> (orçamento <Link href={`/orcamentos/${origem.orcamento.id}`} className="font-mono hover:underline">{origem.orcamento.codigo}</Link>)</span>}
        </>
      ) : origem.orcamento ? (
        <>Orçamento <Link href={`/orcamentos/${origem.orcamento.id}`} className="font-mono font-semibold text-acento hover:underline">{origem.orcamento.codigo}</Link></>
      ) : (
        <>Avulso{pedido.motivo ? <span className="text-ink-muted"> — {pedido.motivo}</span> : null}</>
      )}
    </span>
  );
}

export function StatusPedidoBadge({ status, desde }: { status: PedidoTela["status"]; desde?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <span className={CLASSE_STATUS_PEDIDO[status]} data-status-pedido={status}>{LABEL_STATUS_PEDIDO[status]}</span>
      {desde && <span className="text-[11px] text-ink-muted whitespace-nowrap" data-status-desde>desde {formatarData(desde)}</span>}
    </span>
  );
}

/**
 * O pedido inteiro num painel — na página do pedido e aberto inline na OS/orçamento: situação e origem,
 * Baixar PDF / E-mail / WhatsApp ao fornecedor (cada um no histórico; "Solicitado" vira "Em cotação"),
 * edição inline até concluir/cancelar, itens e histórico.
 */
export function PedidoPainel({ inicial, onMudou, compacto, semNumero }: {
  inicial: PedidoTela;
  /** Avisa quem lista os pedidos (status/itens mudaram) */
  onMudou?: (p: PedidoTela) => void;
  /** Dentro da OS/orçamento: sem repetir número/origem no topo */
  compacto?: boolean;
  /** Na página do pedido o número já está no título */
  semNumero?: boolean;
}) {
  const [pedido, setPedido] = useState(inicial);
  const [editando, setEditando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const encerrado = pedidoEncerrado(pedido.status);

  async function recarregar() {
    const r = await fetch(`/api/pedidos-compra/${pedido.id}`, { cache: "no-store" });
    if (!r.ok) return;
    const p: PedidoTela | null = await r.json().catch(() => null);
    if (!p?.id) return;
    setPedido(p);
    onMudou?.(p);
  }

  async function enviar(canal: CanalEnvioPedido) {
    const aba = canal === "WHATSAPP" ? abaPendente() : null;
    // O PDF abre já no clique (o navegador não bloqueia); o servidor só registra
    if (canal === "BAIXAR") {
      try { window.open(`/pedido-compra/${pedido.tokenPublico}?imprimir=1`, "_blank", "noopener"); } catch { /* sem janela */ }
    }
    setOcupado(canal);
    try {
      const res = await fetch(`/api/pedidos-compra/${pedido.id}/enviar`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ canal }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { aba?.fechar(); toast(d.erro ?? "Não foi possível enviar.", "erro"); return; }
      if (canal === "WHATSAPP" && d.whatsappUrl) aba?.ir(d.whatsappUrl);
      if (canal === "EMAIL") {
        if (d.emailEnviado) toast(`Pedido enviado por e-mail para ${pedido.fornecedor?.email}.`);
        else if (d.mailtoUrl) { toast("E-mail da empresa não configurado: abrimos o seu e-mail com o pedido.", "info"); window.location.href = d.mailtoUrl; }
      }
      await recarregar();
    } catch { aba?.fechar(); toast("Erro de conexão.", "erro"); } finally { setOcupado(null); }
  }

  async function cancelar() {
    if (!(await confirmar({ titulo: `Cancelar o pedido ${pedido.numero}?`, mensagem: "O pedido fica no histórico como cancelado e não pode mais ser editado nem enviado.", confirmarTexto: "Cancelar pedido", cancelarTexto: "Voltar", perigo: true }))) return;
    setOcupado("CANCELAR");
    try {
      const res = await fetch(`/api/pedidos-compra/${pedido.id}/cancelar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast(d.erro ?? "Não foi possível cancelar.", "erro"); return; }
      toast("Pedido cancelado.");
      await recarregar();
    } catch { toast("Erro de conexão.", "erro"); } finally { setOcupado(null); }
  }

  const botaoEnvio = (canal: CanalEnvioPedido, rotulo: string, Icone: typeof Mail, attr: string) => {
    const falta = canal !== "BAIXAR" && encerrado ? "Pedido encerrado: não dá mais para enviar." : faltaParaEnviar(canal, pedido.fornecedor);
    return (
      <Button variant={canal === "BAIXAR" ? "outline" : "secondary"} size="sm" onClick={() => enviar(canal)} disabled={!!falta || !!ocupado}
        loading={ocupado === canal} title={falta ?? undefined} {...{ [attr]: "" }}>
        <Icone className="w-4 h-4" /> {rotulo}
      </Button>
    );
  };
  const total = totalEstimadoPedido(pedido.itens);

  return (
    <div className="space-y-4" data-painel-pedido={pedido.id}>
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="space-y-1 min-w-0">
          {!compacto && !semNumero && <p className="font-mono text-lg font-bold text-acento">{pedido.numero}</p>}
          <StatusPedidoBadge status={pedido.status} desde={pedido.statusEm} />
          {!compacto && <p className="text-sm text-ink"><span className="text-ink-muted">Origem:</span> <OrigemPedido pedido={pedido} /></p>}
        </div>
        <div className="flex flex-wrap gap-2" data-acoes-pedido>
          {pedido.podeEnviar && (
            <>
              {botaoEnvio("BAIXAR", "Baixar PDF", Download, "data-baixar-pc")}
              {botaoEnvio("EMAIL", "E-mail", Mail, "data-enviar-email-pc")}
              {botaoEnvio("WHATSAPP", "WhatsApp", MessageCircle, "data-enviar-whatsapp-pc")}
            </>
          )}
          {pedido.podeEditar && !editando && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setEditando(true)} disabled={!!ocupado} data-editar-pedido><Pencil className="w-4 h-4" /> Editar</Button>
              <Button variant="ghost" size="sm" onClick={cancelar} disabled={!!ocupado} loading={ocupado === "CANCELAR"} data-cancelar-pedido><Ban className="w-4 h-4" /> Cancelar</Button>
            </>
          )}
        </div>
      </div>
      {pedido.podeEnviar && !encerrado && !pedido.fornecedor && (
        <p className="text-xs text-atencao-texto bg-atencao-claro border border-atencao/30 rounded-lg px-3 py-2" data-aviso-sem-fornecedor>
          Sem fornecedor escolhido: dá para baixar o PDF; para enviar por e-mail ou WhatsApp, edite o pedido e escolha o fornecedor.
        </p>
      )}

      {editando ? (
        <div className="border border-acento/30 bg-acento-claro/30 rounded-lg p-3 sm:p-4">
          <EditorPedido
            pedido={pedido}
            onCancelar={() => setEditando(false)}
            onSalvo={(p) => {
              setEditando(false);
              const { mudancas, ...resto } = p;
              setPedido(resto);
              onMudou?.(resto);
              toast(mudancas?.length ? "Pedido atualizado." : "Nada mudou.", mudancas?.length ? "sucesso" : "info");
            }}
          />
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 text-sm" data-dados-pedido>
            <div><dt className="text-ink-muted inline">Solicitado por:</dt> <dd className="inline text-ink">{pedido.solicitante.nome} · {formatarData(pedido.criadoEm)}</dd></div>
            <div><dt className="text-ink-muted inline">Comprador:</dt> <dd className="inline text-ink" data-comprador>{pedido.comprador?.nome ?? "—"}</dd></div>
            <div><dt className="text-ink-muted inline">Prazo necessário:</dt> <dd className="inline text-ink">{pedido.prazoNecessario ? formatarData(pedido.prazoNecessario) : "—"}</dd></div>
            <div className="sm:col-span-2 lg:col-span-3"><dt className="text-ink-muted inline">Fornecedor:</dt> <dd className="inline text-ink" data-fornecedor>
              {pedido.fornecedor ? [pedido.fornecedor.nome, pedido.fornecedor.email, pedido.fornecedor.telefone].filter(Boolean).join(" · ") : "A definir"}
            </dd></div>
            {pedido.observacao && <div className="sm:col-span-2 lg:col-span-3"><dt className="text-ink-muted inline">Observação:</dt> <dd className="inline text-ink whitespace-pre-wrap">{pedido.observacao}</dd></div>}
          </dl>

          <div className="overflow-x-auto border border-surface-border rounded-lg">
            <table className="w-full text-sm" data-itens-pedido>
              <thead className="bg-surface-alt border-b border-surface-border">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-ink-muted text-xs uppercase">Produto / descrição</th>
                  <th className="text-right px-3 py-2 font-semibold text-ink-muted text-xs uppercase">Qtd</th>
                  <th className="text-right px-3 py-2 font-semibold text-ink-muted text-xs uppercase hidden sm:table-cell">Estimado</th>
                  <th className="text-right px-3 py-2 font-semibold text-ink-muted text-xs uppercase hidden sm:table-cell">Real (NF)</th>
                </tr>
              </thead>
              <tbody>
                {pedido.itens.map((i) => (
                  <tr key={i.id} className="border-b border-surface-border last:border-0">
                    <td className="px-3 py-2 text-ink">
                      {i.descricao}
                      {i.produtoNome && i.produtoNome !== i.descricao && <span className="block text-[11px] text-ink-muted">{i.produtoNome}</span>}
                      <span className="sm:hidden block text-[11px] text-ink-muted">
                        Estimado {i.valorEstimado != null ? formatarMoeda(i.valorEstimado) : "—"}{i.valorReal != null ? ` · Real ${formatarMoeda(i.valorReal)}` : ""}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-ink-muted whitespace-nowrap tabular-nums">{qtd(i.quantidade)} {i.unidade}</td>
                    <td className="px-3 py-2 text-right text-ink-muted tabular-nums hidden sm:table-cell">{i.valorEstimado != null ? formatarMoeda(i.valorEstimado) : "—"}</td>
                    <td className="px-3 py-2 text-right font-semibold text-ink tabular-nums hidden sm:table-cell">{i.valorReal != null ? formatarMoeda(i.valorReal) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              {total > 0 && (
                <tfoot>
                  <tr className="border-t border-surface-border">
                    <td colSpan={2} className="px-3 py-2 text-right text-xs font-semibold text-ink-muted">Total estimado</td>
                    <td className="px-3 py-2 text-right font-bold text-ink tabular-nums" colSpan={2} data-total-estimado>{formatarMoeda(total)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}

      <section data-historico-pedido>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-muted flex items-center gap-1.5 mb-2"><History className="w-3.5 h-3.5" /> Histórico</h4>
        {pedido.eventos.length === 0 ? (
          <p className="text-xs text-ink-subtle">Sem registros.</p>
        ) : (
          <ol className="space-y-2 border-l-2 border-surface-border pl-3">
            {pedido.eventos.map((e) => (
              <li key={e.id} className="text-sm" data-evento={e.tipo}>
                <p className="text-ink"><span className="font-medium">{ROTULO_EVENTO_PEDIDO[e.tipo] ?? e.tipo}</span>
                  <span className="text-xs text-ink-muted"> · {formatarDataHora(e.criadoEm)}{e.usuarioNome ? ` · ${e.usuarioNome}` : ""}</span></p>
                {e.detalhe && <p className="text-xs text-ink-muted whitespace-pre-line">{e.detalhe}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
