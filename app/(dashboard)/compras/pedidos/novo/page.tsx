import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { PageHeader } from "@/components/ui/page-header";
import { NovoPedidoAvulso } from "@/components/compras/novo-pedido-avulso";

export const metadata: Metadata = { title: "Novo pedido avulso" };

const AJUDA = "Pedido que não nasce de OS nem de orçamento — reposição de estoque, ferramenta, consumível. Os itens com produto do cadastro trazem a última compra como referência de valor, e o estoque sugere o que está no mínimo ou abaixo. Depois de criado, o pedido segue o mesmo ciclo dos outros.";

/** PC avulso (sem OS/orçamento — ex.: reposição de estoque): Compras › Gerenciar, na tela e na API */
export default async function NovoPedidoAvulsoPage() {
  const session = await auth();
  const u = session!.user!;
  if (!pode(u.permissoes, "compras", "gerenciar", u.role)) redirect("/sem-permissao");
  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <PageHeader title="Novo pedido avulso" description="Sem OS nem orçamento — por exemplo, reposição de estoque." dica={AJUDA} backHref="/compras/pedidos" />
      <div className="card-padded">
        <NovoPedidoAvulso />
      </div>
    </div>
  );
}
