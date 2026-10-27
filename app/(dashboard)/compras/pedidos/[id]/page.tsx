import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { podeVerPedido } from "@/lib/compras/pedido";
import { marcarNfVista } from "@/lib/compras/conciliacao-server";
import { carregarPedido, pedidoParaTela } from "@/lib/compras/pedido-server";
import { PageHeader } from "@/components/ui/page-header";
import { PedidoPainel } from "@/components/compras/pedido-painel";

export const metadata: Metadata = { title: "Pedido de Compra" };

export default async function PedidoCompraDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const u = session!.user!;
  const pedido = await carregarPedido(id, u.empresaId);
  if (!pedido) notFound();
  // Mesma regra da API: Compras, comprador designado ou quem vê a OS/orçamento de origem
  if (!podeVerPedido(u, pedido)) redirect("/sem-permissao");
  // Quem pediu abriu o pedido depois que a NF chegou: apaga o aviso do sino
  await marcarNfVista(pedido, u.id, u.empresaId);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <PageHeader title={`Pedido ${pedido.numero}`} description={`Solicitado por ${pedido.solicitante.nome}`} backHref={pode(u.permissoes, "compras", "visualizar", u.role) ? "/compras/pedidos" : "/dashboard"} />
      <div className="card-padded">
        <PedidoPainel inicial={pedidoParaTela(pedido, u)} semNumero />
      </div>
    </div>
  );
}
