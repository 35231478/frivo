/**
 * Aprovação da medição — núcleo único do "Aprovar" (tela), do link do cliente e da rotina automática.
 * Atômico: só a primeira aprovação muda o status; a conta a receber nasce uma vez só (gerarContaReceberDaMedicao).
 * D2: o vencimento sai da regra do contrato (medição de um contrato) ou do dia do cliente.
 */
import { prisma } from "@/lib/prisma";
import { statusAposAprovacao } from "@/lib/medicao-helpers";
import { gerarContaReceberDaMedicao } from "@/lib/financeiro-server";
import { vencimentoDaMedicao } from "@/lib/faturamento/medicao-contrato-server";

export type Assinatura = { assinadoPor: string; assinadoCpf: string; assinaturaUrl?: string | null };

/** RASCUNHO/AGUARDANDO → AGUARDANDO_APROVACAO (guarda a 1ª data de envio). false = não estava num status que envia */
export async function marcarEnviada(medicaoId: string): Promise<boolean> {
  const m = await prisma.medicao.findUnique({ where: { id: medicaoId }, select: { status: true, dataEnvio: true } });
  if (!m || (m.status !== "RASCUNHO" && m.status !== "AGUARDANDO_APROVACAO")) return false;
  const r = await prisma.medicao.updateMany({
    where: { id: medicaoId, status: { in: ["RASCUNHO", "AGUARDANDO_APROVACAO"] } },
    data: { status: "AGUARDANDO_APROVACAO", dataEnvio: m.dataEnvio ?? new Date() },
  });
  return r.count === 1;
}

/** AGUARDANDO_APROVACAO → AGUARDANDO_PC/PC_RECEBIDO + conta a receber. null = não estava aguardando (outro aprovou antes) */
export async function aprovarMedicao(medicaoId: string, assinatura?: Assinatura) {
  const m = await prisma.medicao.findUnique({
    where: { id: medicaoId },
    select: { status: true, contratoId: true, mes: true, ano: true, cliente: { select: { exigePcAntesNf: true, diaFaturamento: true } } },
  });
  if (!m || m.status !== "AGUARDANDO_APROVACAO") return null;
  const proximo = statusAposAprovacao(m.cliente.exigePcAntesNf);
  const vencimento = await vencimentoDaMedicao(prisma, m);
  const r = await prisma.medicao.updateMany({
    where: { id: medicaoId, status: "AGUARDANDO_APROVACAO" },
    data: {
      status: proximo, dataAprovacao: new Date(), dataVencimento: vencimento,
      ...(assinatura ? { assinadoPor: assinatura.assinadoPor, assinadoCpf: assinatura.assinadoCpf, assinaturaUrl: assinatura.assinaturaUrl ?? null } : {}),
    },
  });
  if (r.count !== 1) return null;
  await gerarContaReceberDaMedicao(medicaoId);
  return { status: proximo };
}
