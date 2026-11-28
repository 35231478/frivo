import type { Metadata } from "next";
import { requirePortalSession } from "@/lib/portal-server";
import { SemAcesso } from "@/components/portal/sem-acesso";
import { PedidoCompraPortal } from "@/components/portal/pedido-compra-portal";
import { acessoPedidoNoPortal, pedidosEnviadosPeloPortal, pendentesDoCliente } from "@/lib/pedido-cliente/portal-server";
import { FileSignature } from "lucide-react";

export const metadata: Metadata = { title: "Portal — Pedido de compra" };
export const dynamic = "force-dynamic";

/**
 * PC-2 — "Pedido de compra" (o nome que o cliente usa): o que aguarda o pedido e o envio do pedido. Só o comprador
 * (a permissão "Enviar pedido de compra" ou o "Contato de compras" da ficha) de um cliente que exige o pedido.
 */
export default async function PortalPedidosCompra() {
  const { user } = await requirePortalSession();
  const acesso = await acessoPedidoNoPortal(user);
  if (!acesso.pode) return <SemAcesso />;
  const [itens, enviados] = await Promise.all([pendentesDoCliente(user.empresaId, user.clienteId), pedidosEnviadosPeloPortal(user.empresaId, user.clienteId)]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2"><FileSignature className="w-6 h-6 text-primary-600" aria-hidden /> Pedido de compra</h1>
        <p className="text-sm text-ink-muted mt-1">Anexe aqui o pedido de compra dos serviços já prestados. Assim que a equipe confere, o faturamento segue.</p>
      </div>
      <PedidoCompraPortal
        itens={itens.map((i) => ({ ...i, concluidoEm: i.concluidoEm?.toISOString() ?? null, ultimoLembrete: undefined }))}
        enviados={enviados.map((p) => ({ id: p.id, numero: p.numero, data: p.data.toISOString(), valor: p.valor, situacao: p.situacao, motivoRecusa: p.motivoRecusa, enviadoEm: p.enviadoEm.toISOString(), itens: p.itens }))}
      />
    </div>
  );
}
