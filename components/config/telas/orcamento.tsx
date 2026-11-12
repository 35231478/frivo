import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/page-header";
import { OrcamentoPadroesClient } from "@/components/config/orcamento-padroes-client";

/** Configurações › Operacionais › Orçamentos e propostas (padrões do orçamento novo). */
export async function TelaOrcamento() {
  const session = await auth();
  const u = session!.user!;
  const cfg = await prisma.configuracao.upsert({
    where: { empresaId: u.empresaId },
    create: { empresaId: u.empresaId },
    update: {},
    select: {
      orcamentoValidadeDias: true, orcamentoGarantiaServico: true, orcamentoGarantiaPecas: true,
      orcamentoNaoIncluso: true, orcamentoNormas: true,
    },
  });
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Orçamentos e propostas"
        description="Padrões do orçamento novo"
        dica="Valores preenchidos em cada novo orçamento. Podem ser alterados em cada orçamento; os já criados não são afetados."
        backHref="/configuracoes/operacionais"
      />
      <OrcamentoPadroesClient inicial={cfg} podeEditar={pode(u.permissoes, "configuracoes", "gerenciar", u.role)} />
    </div>
  );
}
