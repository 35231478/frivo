/**
 * O relatório da visita no app: o link público (com o token da atividade) e o que a mensagem do WhatsApp diz.
 * O técnico só recebe o da atividade dele (o retrato já é do escopo dele).
 */
import { prisma } from "@/lib/prisma";
import { linkRelatorioAtividade } from "@/lib/relatorio-atividade-link";
import type { RelatorioRetrato } from "@/lib/tecnico/offline/tipos";

export async function relatorioParaRetrato(empresaId: string, atividadeId: string): Promise<RelatorioRetrato | null> {
  const a = await prisma.atividadeOs.findFirst({
    where: { id: atividadeId, empresaId },
    select: {
      id: true, tokenRelatorio: true,
      ordemServico: { select: { numero: true, chamadoNumero: true, empresa: { select: { nome: true, nomeFantasia: true } } } },
    },
  });
  if (!a?.tokenRelatorio) return null;
  const os = a.ordemServico;
  return {
    link: linkRelatorioAtividade({ id: a.id, tokenRelatorio: a.tokenRelatorio }),
    empresa: os.empresa.nomeFantasia || os.empresa.nome,
    osNumero: os.chamadoNumero ?? os.numero,
  };
}
