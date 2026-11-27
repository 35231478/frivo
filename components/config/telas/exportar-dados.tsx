import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/page-header";
import { DICA_EXPORTAR, podeExportar } from "@/lib/exportacao/arquivos";
import { MSG_SO_ADMIN } from "@/lib/exportacao/acesso";
import { ExportarDadosClient } from "@/components/config/exportar-dados-client";

/**
 * Configurações › Conta › Empresa › Exportar dados — o backup portátil da empresa (só o administrador).
 * A tela só oferece os links; quem confere o papel e registra cada exportação é a rota.
 */
export async function TelaExportarDados() {
  const session = await auth();
  const u = session!.user!;
  const admin = podeExportar(u.role);
  const historico = admin
    ? await prisma.exportacaoDados.findMany({
      where: { empresaId: u.empresaId }, orderBy: { criadoEm: "desc" }, take: 20,
      select: { id: true, usuarioNome: true, parte: true, criadoEm: true, concluidaEm: true, arquivos: true, linhas: true, erro: true },
    })
    : [];
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Exportar dados"
        description="Cópia dos dados da empresa em planilhas"
        dica={DICA_EXPORTAR}
        backHref="/configuracoes?aba=conta"
      />
      {admin ? (
        <ExportarDadosClient
          inicial={historico.map((e) => ({ ...e, criadoEm: e.criadoEm.toISOString(), concluidaEm: e.concluidaEm?.toISOString() ?? null }))}
        />
      ) : (
        <div className="card p-4 text-sm text-ink-muted" data-exportar-sem-permissao>{MSG_SO_ADMIN}</div>
      )}
    </div>
  );
}
