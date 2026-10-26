import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { getConfigRelatorio } from "@/lib/relatorio-os/config-server";
import { PageHeader } from "@/components/ui/page-header";
import { ImpressaoOsClient } from "@/components/config/impressao-os-client";

/** Configurações › Operacionais › Impressão da OS (rota protegida por Configurações › visualizar). */
export async function TelaImpressaoOs() {
  const session = await auth();
  const u = session!.user!;
  const config = await getConfigRelatorio(u.empresaId);
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Impressão da OS"
        description="O que sai no relatório da OS e quem vê cada parte: o cliente ou só a equipe interna."
        backHref="/configuracoes/operacionais"
      />
      <ImpressaoOsClient inicial={config} podeEditar={pode(u.permissoes, "configuracoes", "gerenciar", u.role)} />
    </div>
  );
}
