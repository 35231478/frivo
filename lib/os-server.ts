import { prisma } from "@/lib/prisma";

/** A OS existe e é da empresa? (toda rota de /api/ordens/[id]/** deve checar antes de agir) */
export async function osDaEmpresa(id: string, empresaId: string) {
  return prisma.ordemServico.findFirst({ where: { id, empresaId }, select: { id: true, status: true, numero: true } });
}

/**
 * Regra de inativação (cancelamento) da OS: não pode inativar OS que já entrou no
 * financeiro (medição VIVA — MedicaoItem → Medicao não cancelada). Retorna o motivo
 * do bloqueio, ou null quando pode inativar. A antiga "medição interna" (OsMedicao)
 * saiu do sistema: nunca virava conta a receber e só travava a OS.
 */
export async function motivoBloqueioInativacao(osId: string): Promise<string | null> {
  const itemMedicao = await prisma.medicaoItem.findFirst({
    where: { ordemServicoId: osId, medicao: { status: { not: "CANCELADA" } } },
    select: { medicao: { select: { numero: true, status: true } } },
  });
  if (itemMedicao) {
    return `Esta OS já está na medição ${itemMedicao.medicao.numero} (financeiro). Cancele ou remova a OS da medição antes de inativá-la.`;
  }
  return null;
}

/** O número da OS vem do contador da empresa: ver `proximoNumeroOs` em lib/os/abertura (um helper só). */
export { proximoNumeroOs } from "@/lib/os/abertura";
