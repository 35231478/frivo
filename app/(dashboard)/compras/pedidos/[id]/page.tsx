import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { exigirModuloNaPagina } from "@/lib/modulos/pagina";
import { pode } from "@/lib/permissoes";
import { podeVerPedido } from "@/lib/compras/pedido";
import { marcarNfVista } from "@/lib/compras/conciliacao-server";
import { carregarPedido, pedidoParaTela } from "@/lib/compras/pedido-server";
import { PageHeader } from "@/components/ui/page-header";
import { PedidoPainel } from "@/components/compras/pedido-painel";

export const metadata: Metadata = { title: "Pedido de compra" };

const AJUDA = "O ciclo do pedido: Solicitado, Cotando, Comprado e Concluído. Cada passo guarda quem fez e quando, e o fornecedor e o valor podem ser ajustados até a compra. Quando a NF-e chegar, importe em Estoque › Notas de compra e ligue a nota a este pedido — é o que vira entrada no estoque e conta a pagar.";

export default async function PedidoCompraDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Módulo da empresa (entitlement): desligado, a rota redireciona — acima do RBAC do usuário
  const session = await exigirModuloNaPagina("compras");
  const u = session!.user!;
  const pedido = await carregarPedido(id, u.empresaId);
  if (!pedido) notFound();
  // Mesma regra da API: Compras, comprador designado ou quem vê a OS/orçamento de origem
  if (!podeVerPedido(u, pedido)) redirect("/sem-permissao");
  // Quem pediu abriu o pedido depois que a NF chegou: apaga o aviso do sino
  await marcarNfVista(pedido, u.id, u.empresaId);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <PageHeader title={`Pedido ${pedido.numero}`} description={`Solicitado por ${pedido.solicitante.nome}`} dica={AJUDA} backHref={pode(u.permissoes, "compras", "visualizar", u.role) ? "/compras/pedidos" : "/dashboard"} />
      <div className="card-padded">
        <PedidoPainel inicial={pedidoParaTela(pedido, u)} semNumero />
      </div>
    </div>
  );
}
