import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/page-header";
import { PedidoStatusAcoes } from "@/components/compras/pedido-status-acoes";
import { cn, formatarData, formatarDataHora, formatarMoeda, LABELS_STATUS_PEDIDO_COMPRA, CLASSE_STATUS_PEDIDO_COMPRA } from "@/lib/utils";
import { ClipboardList } from "lucide-react";

export const metadata: Metadata = { title: "Pedido de Compra" };

const PASSOS = ["SOLICITADO", "COTANDO", "COMPRADO", "ENTREGUE"];

export default async function PedidoCompraDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const pedido = await prisma.pedidoCompraInterno.findFirst({
    where: { id, empresaId },
    include: {
      itens: { include: { produto: { select: { nome: true } } } },
      comprador: { select: { nome: true } },
      solicitante: { select: { nome: true } },
      ordemServico: { select: { id: true, numero: true, cliente: { select: { nome: true, nomeFantasia: true } } } },
      orcamento: { select: { id: true, codigo: true } },
    },
  });
  if (!pedido) notFound();

  const passoAtual = PASSOS.indexOf(pedido.status);
  const totalEstimado = pedido.itens.reduce((acc, i) => acc + (i.valorEstimado ? Number(i.valorEstimado) : 0), 0);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <PageHeader title={`Pedido ${pedido.numero}`} description={`Solicitado por ${pedido.solicitante.nome}`} backHref="/compras/pedidos" />

      <div className="card-padded space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <span className={CLASSE_STATUS_PEDIDO_COMPRA[pedido.status]}>{LABELS_STATUS_PEDIDO_COMPRA[pedido.status]}</span>
          <PedidoStatusAcoes pedidoId={pedido.id} status={pedido.status} />
        </div>

        {/* Stepper */}
        {pedido.status !== "CANCELADO" && (
          <div className="flex items-center gap-1 pt-2">
            {PASSOS.map((p, i) => (
              <div key={p} className="flex-1 flex items-center gap-1">
                <div className="flex flex-col items-center gap-1 flex-1">
                  <div className={cn("w-full h-1.5 rounded-full", i <= passoAtual ? "bg-success-500" : "bg-surface-border")} />
                  <span className={cn("text-[11px]", i <= passoAtual ? "text-ink font-medium" : "text-ink-subtle")}>{LABELS_STATUS_PEDIDO_COMPRA[p]}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card-padded space-y-3">
        <h2 className="card-title">Informações</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          {pedido.ordemServico && (
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-ink-muted" />
              <span className="text-ink-muted">OS:</span>
              <Link href={`/ordens/${pedido.ordemServico.id}`} className="font-mono text-primary-600 hover:underline">{pedido.ordemServico.numero}</Link>
              <span className="text-ink-muted">— {pedido.ordemServico.cliente.nomeFantasia ?? pedido.ordemServico.cliente.nome}</span>
            </div>
          )}
          {pedido.orcamento && (
            <div><span className="text-ink-muted">Orçamento:</span>{" "}
              <Link href={`/orcamentos/${pedido.orcamento.id}`} className="font-mono text-primary-600 hover:underline">{pedido.orcamento.codigo}</Link>
            </div>
          )}
          <div><span className="text-ink-muted">Comprador:</span> <span className="text-ink">{pedido.comprador?.nome ?? "—"}</span></div>
          <div><span className="text-ink-muted">Prazo necessário:</span> <span className="text-ink">{formatarData(pedido.prazoNecessario)}</span></div>
          <div><span className="text-ink-muted">Criado em:</span> <span className="text-ink">{formatarDataHora(pedido.criadoEm)}</span></div>
        </div>
        {pedido.observacao && (
          <div className="text-sm"><span className="text-ink-muted">Observação:</span> <span className="text-ink whitespace-pre-wrap">{pedido.observacao}</span></div>
        )}
      </div>

      <div className="card-padded">
        <h2 className="card-title mb-3">Itens</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-alt border-b border-surface-border">
              <tr>
                <th className="text-left px-3 py-2 font-semibold text-ink-muted text-xs uppercase">Descrição</th>
                <th className="text-right px-3 py-2 font-semibold text-ink-muted text-xs uppercase">Qtd</th>
                <th className="text-left px-3 py-2 font-semibold text-ink-muted text-xs uppercase">Fornecedor</th>
                <th className="text-right px-3 py-2 font-semibold text-ink-muted text-xs uppercase">Estimado</th>
                <th className="text-right px-3 py-2 font-semibold text-ink-muted text-xs uppercase">Real</th>
              </tr>
            </thead>
            <tbody>
              {pedido.itens.map((i) => (
                <tr key={i.id} className="border-b border-surface-border">
                  <td className="px-3 py-2.5 text-ink">{i.descricao}</td>
                  <td className="px-3 py-2.5 text-right text-ink-muted">{Number(i.quantidade)} {i.unidade}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{i.fornecedor ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right text-ink-muted">{i.valorEstimado ? formatarMoeda(Number(i.valorEstimado)) : "—"}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-ink">{i.valorReal ? formatarMoeda(Number(i.valorReal)) : "—"}</td>
                </tr>
              ))}
            </tbody>
            {totalEstimado > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-right font-semibold text-ink-muted">Total estimado</td>
                  <td className="px-3 py-2 text-right font-bold text-ink">{formatarMoeda(totalEstimado)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
