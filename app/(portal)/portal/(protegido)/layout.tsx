import { requirePortalSession, getPortalBranding } from "@/lib/portal-server";
import { PortalShell } from "@/components/portal/portal-shell";

export const dynamic = "force-dynamic";

export default async function PortalProtegidoLayout({ children }: { children: React.ReactNode }) {
  const sessao = await requirePortalSession();
  const branding = await getPortalBranding(sessao.user.empresaId);

  return (
    <PortalShell
      contatoNome={sessao.user.name ?? "Cliente"}
      clienteNome={sessao.user.clienteNome}
      branding={branding}
      permissoes={sessao.user.permissoes ?? {}}
    >
      {children}
    </PortalShell>
  );
}
