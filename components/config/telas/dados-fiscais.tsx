import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { PageHeader } from "@/components/ui/page-header";
import { DadosFiscaisClient } from "@/components/fiscal/dados-fiscais-client";
import { carregarEmitente } from "@/lib/nfse/emitente-server";

/**
 * Dados fiscais da empresa como emitente de NFS-e (PlugNotas). Abre na gaveta de Configurações e
 * em Financeiro › Fiscal. Gate: Financeiro › Fiscal (NFS-e), conferido aqui e em cada API.
 */
export async function TelaDadosFiscais({ voltar = "/configuracoes" }: { voltar?: string }) {
  const session = await auth();
  const u = session!.user!;
  if (!pode(u.permissoes, "financeiro", "fiscal", u.role)) redirect("/sem-permissao");
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Dados fiscais (NFS-e)" description="A empresa como emitente de notas fiscais de serviço, pelo PlugNotas" backHref={voltar} />
      <div className="bg-white rounded-card border border-surface-border p-4 sm:p-6">
        <DadosFiscaisClient inicial={await carregarEmitente(u.empresaId)} />
      </div>
    </div>
  );
}
