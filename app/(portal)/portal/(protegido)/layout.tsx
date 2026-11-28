import { requirePortalSession, getPortalBranding } from "@/lib/portal-server";
import { PortalShell } from "@/components/portal/portal-shell";
import { acessoPedidoNoPortal } from "@/lib/pedido-cliente/portal-server";

export const dynamic = "force-dynamic";

export default async function PortalProtegidoLayout({ children }: { children: React.ReactNode }) {
  const sessao = await requirePortalSession();
  const [branding, pedido] = await Promise.all([getPortalBranding(sessao.user.empresaId), acessoPedidoNoPortal(sessao.user)]);

  return (
    <PortalShell
      contatoNome={sessao.user.name ?? "Cliente"}
      clienteNome={sessao.user.clienteNome}
      branding={branding}
      permissoes={sessao.user.permissoes ?? {}}
      pedidoCompra={pedido.pode}
    >
      {children}
    </PortalShell>
  );
}
