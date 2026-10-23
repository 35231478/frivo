import { prisma } from "@/lib/prisma";
import { anoBR } from "@/lib/fuso";

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

/**
 * Próximo número de OS do ano ("OS-2026-0042"), pelo MAIOR sequencial já usado.
 * (Contar as OS e somar 1 colide com números existentes e derrubava a abertura de
 * chamado pelo portal/QR com erro de número duplicado.)
 */
export async function proximoNumeroOs(empresaId: string, ano = anoBR()): Promise<string> {
  const prefixo = `OS-${ano}-`;
  const [r] = await prisma.$queryRaw<{ max: number | null }[]>`
    SELECT MAX(CAST(split_part(numero, '-', 3) AS INTEGER)) AS max
    FROM ordens_servico
    WHERE empresa_id = ${empresaId} AND numero LIKE ${prefixo + "%"} AND split_part(numero, '-', 3) ~ '^[0-9]{1,9}$'`;
  return `${prefixo}${String((r?.max ?? 0) + 1).padStart(4, "0")}`;
}
