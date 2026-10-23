import { prisma } from "@/lib/prisma";
import { verificarConclusaoOs } from "@/lib/execucao/dados";
import { gerarRelatoriosDaOs } from "@/lib/relatorio-server";
import { estagioAutomatico, statusCorresponde, statusDoEstagio, type StatusOsGravado } from "@/lib/os/status";

/**
 * Recalcula e GRAVA o status automático da OS depois de qualquer mudança que o afete
 * (atividade criada/editada/excluída/iniciada/concluída, reagendamento, reabertura).
 *
 *  - Ajuste manual ligado ou OS cancelada: não toca em nada (exceção é do usuário);
 *  - Concluída só quando a trava da OS passa (pelo menos 1 equipamento atendido e cada atendido
 *    completo) — se não passar, fica "Em andamento" até resolver;
 *  - Grava as datas de início/conclusão como o ajuste manual já gravava, e anota no histórico
 *    ("Status automático: X → Y") em nome de quem causou a mudança;
 *  - Ao concluir, gera os relatórios da OS (o mesmo efeito da conclusão manual).
 *
 * Idempotente: chamar de novo sem mudança não grava nada. Devolve o status final.
 */
export async function sincronizarStatusOs(osId: string, empresaId: string, usuarioId?: string | null): Promise<string | null> {
  const os = await prisma.ordemServico.findFirst({
    where: { id: osId, empresaId },
    select: {
      id: true, status: true, statusManual: true, dataInicio: true, dataConclusao: true, criadoPorId: true,
      atividades: { select: { status: true, dataAgendada: true } },
      medicaoItens: { select: { medicao: { select: { status: true } } } },
    },
  });
  if (!os) return null;
  if (os.statusManual || os.status === "CANCELADA") return os.status;

  const estagio = estagioAutomatico({ status: os.status, atividades: os.atividades, medicoes: os.medicaoItens.map((m) => m.medicao) });
  if (statusCorresponde(os.status, estagio)) return os.status;

  let alvo: StatusOsGravado = statusDoEstagio(estagio);
  if (alvo === "CONCLUIDA" && !(await verificarConclusaoOs(empresaId, osId)).ok) alvo = "EM_ANDAMENTO";
  if (alvo === os.status) return os.status;

  const agora = new Date();
  const { count } = await prisma.ordemServico.updateMany({
    // Só grava se ninguém mudou o status no meio (corrida entre duas ações)
    where: { id: osId, status: os.status as StatusOsGravado, statusManual: false },
    data: {
      status: alvo,
      ...((alvo === "EM_ANDAMENTO" || alvo === "CONCLUIDA") && !os.dataInicio && { dataInicio: agora }),
      ...(alvo === "CONCLUIDA" && !os.dataConclusao && { dataConclusao: agora }),
    },
  });
  if (!count) return os.status;

  await prisma.osHistorico.create({
    data: { ordemServicoId: osId, usuarioId: usuarioId ?? os.criadoPorId, acao: "Status automático", detalhes: `${os.status} → ${alvo}` },
  });
  if (alvo === "CONCLUIDA") {
    try { await gerarRelatoriosDaOs(osId, empresaId); }
    catch (e) { console.error("Falha ao gerar relatórios automáticos da OS", e); }
  }
  return alvo;
}
