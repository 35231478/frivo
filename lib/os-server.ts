import { prisma } from "@/lib/prisma";

/** A OS existe e é da empresa? (toda rota de /api/ordens/[id]/** deve checar antes de agir) */
export async function osDaEmpresa(id: string, empresaId: string) {
  return prisma.ordemServico.findFirst({ where: { id, empresaId }, select: { id: true, status: true, numero: true } });
}

/**
 * Regra de inativação (cancelamento) da OS: não pode inativar OS que já entrou no
 * financeiro. Retorna o motivo do bloqueio, ou null quando pode inativar.
 * - medição financeira vinculada (MedicaoItem → Medicao não cancelada);
 * - medição interna da OS (OsMedicao) já gerada.
 */
export async function motivoBloqueioInativacao(osId: string): Promise<string | null> {
  const [itemMedicao, osMedicao] = await Promise.all([
    prisma.medicaoItem.findFirst({
      where: { ordemServicoId: osId, medicao: { status: { not: "CANCELADA" } } },
      select: { medicao: { select: { numero: true, status: true } } },
    }),
    prisma.osMedicao.findFirst({ where: { ordemServicoId: osId }, select: { numero: true } }),
  ]);
  if (itemMedicao) {
    return `Esta OS já está na medição ${itemMedicao.medicao.numero} (financeiro). Cancele ou remova a OS da medição antes de inativá-la.`;
  }
  if (osMedicao) {
    return `Esta OS já tem a medição #${osMedicao.numero} gerada. OS com medição não pode ser inativada, pois já entrou no faturamento.`;
  }
  return null;
}

/**
 * Próximo número de OS do ano ("OS-2026-0042"), pelo MAIOR sequencial já usado.
 * (Contar as OS e somar 1 colide com números existentes e derrubava a abertura de
 * chamado pelo portal/QR com erro de número duplicado.)
 */
export async function proximoNumeroOs(empresaId: string, ano = new Date().getFullYear()): Promise<string> {
  const prefixo = `OS-${ano}-`;
  const [r] = await prisma.$queryRaw<{ max: number | null }[]>`
    SELECT MAX(CAST(split_part(numero, '-', 3) AS INTEGER)) AS max
    FROM ordens_servico
    WHERE empresa_id = ${empresaId} AND numero LIKE ${prefixo + "%"} AND split_part(numero, '-', 3) ~ '^[0-9]{1,9}$'`;
  return `${prefixo}${String((r?.max ?? 0) + 1).padStart(4, "0")}`;
}
