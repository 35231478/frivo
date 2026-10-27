import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { origemDoPedidoCompleto } from "@/lib/compras/pedido-server";
import { PedidoCompraDocumento } from "@/components/compras/pedido-compra-documento";
import { AutoPrint } from "@/components/orcamento/auto-print";
import { BotaoImprimir } from "@/components/compras/botao-imprimir";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pedido de Compra", robots: { index: false, follow: false } };

/**
 * O Pedido de Compra para o fornecedor, sem login (link com token, sem nenhum preço): ver, imprimir
 * ou salvar em PDF. `?imprimir=1` (o "Baixar PDF" da tela) já abre o diálogo de impressão.
 */
export default async function PedidoCompraPublicoPage({ params, searchParams }: {
  params: Promise<{ token: string }>; searchParams: Promise<{ imprimir?: string }>;
}) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const p = await prisma.pedidoCompraInterno.findUnique({
    where: { tokenPublico: token },
    include: {
      empresa: true,
      itens: { orderBy: { id: "asc" }, include: { produto: { select: { nome: true } } } },
      fornecedor: { select: { nome: true, documento: true, email: true, telefone: true } },
      comprador: { select: { nome: true } },
      ordemServico: { select: { id: true, numero: true } },
      orcamento: { select: { id: true, codigo: true, ordensServico: { select: { ordemServico: { select: { id: true, numero: true } } }, take: 1 } } },
    },
  });
  if (!p) notFound();

  return (
    <>
      <style>{`
        @page { size: A4; margin: 1.5cm; }
        @media print { html, body { background: white !important; } .print-hide { display: none !important; } }
      `}</style>
      <div className="min-h-screen bg-surface-page py-4 sm:py-6 print:min-h-0 print:bg-white print:py-0">
        {p.status === "CANCELADO" && (
          <p className="print-hide max-w-4xl mx-auto mb-3 px-4 py-2 rounded-lg bg-atrasado-claro text-atrasado-texto text-sm font-semibold text-center" data-pedido-cancelado>
            Este pedido de compra foi cancelado.
          </p>
        )}
        <div className="max-w-4xl mx-auto bg-white p-4 sm:p-6 md:p-10 sm:rounded-2xl shadow-card print:shadow-none print:rounded-none print:p-0">
          <PedidoCompraDocumento
            empresa={p.empresa}
            pedido={{
              numero: p.numero, emitidoEm: p.criadoEm, prazoNecessario: p.prazoNecessario, observacao: p.observacao, motivo: p.motivo,
              origem: origemDoPedidoCompleto(p), comprador: p.comprador, fornecedor: p.fornecedor,
              itens: p.itens.map((i) => ({ descricao: i.descricao, produtoNome: i.produto?.nome ?? null, quantidade: Number(i.quantidade), unidade: i.unidade })),
            }}
          />
        </div>
        {sp.imprimir === "1" ? <AutoPrint /> : <BotaoImprimir />}
      </div>
    </>
  );
}
