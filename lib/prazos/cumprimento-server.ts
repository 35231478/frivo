/**
 * CUMPRIMENTO DE PRAZOS — a leitura do banco. As contas são todas de ./cumprimento (puras); aqui só
 * se busca o que elas precisam, sempre da empresa da sessão.
 *
 * O período olha a ABERTURA: a hora em que o cliente abriu o chamado e, sem chamado, a criação da
 * OS. É assim que o cliente conta o mês dele ("em novembro abri 12 chamados") — e é o que o PDF
 * afirma. Nenhum outro recorte faria a mesma frase ser verdadeira.
 */
import { prisma } from "@/lib/prisma";
import { linhaDoCumprimento, linhaRelata, resumoCumprimento, type LinhaCumprimento, type ResumoCumprimento } from "./cumprimento";

/** Os campos que as duas libs de prazo leem, mais os que a tela e o papel mostram. */
const SELECT_CUMPRIMENTO = {
  id: true, numero: true, chamadoNumero: true, status: true, criadoEm: true,
  prazoExecucao: true, previsaoConclusao: true, dataConclusao: true,
  chamadoAbertoEm: true, atendimentoComparecerAte: true, atendimentoResolverAte: true, atendimentoComparecidoEm: true,
  atrasoJustificadoMotivo: true, atrasoJustificadoObs: true,
  cliente: { select: { id: true, nome: true, nomeFantasia: true } },
  contrato: { select: { id: true, numero: true } },
} as const;

export interface FiltroCumprimento {
  /** Começo do período (inclusivo) e fim (exclusivo), como `lerPeriodo` entrega */
  gte?: Date;
  lt?: Date;
  clienteId?: string | null;
  contratoId?: string | null;
}

/** Teto de leitura: um relatório é uma página, não um dump. Acima disso, o período é largo demais. */
export const TETO_LINHAS = 2000;

export function whereCumprimento(empresaId: string, f: FiltroCumprimento) {
  const abertura = f.gte || f.lt ? { ...(f.gte && { gte: f.gte }), ...(f.lt && { lt: f.lt }) } : undefined;
  return {
    empresaId,
    ...(f.clienteId && { clienteId: f.clienteId }),
    ...(f.contratoId && { contratoId: f.contratoId }),
    // A abertura do chamado quando existe; sem chamado, a criação da OS
    ...(abertura && { OR: [{ chamadoAbertoEm: abertura }, { chamadoAbertoEm: null, criadoEm: abertura }] }),
  };
}

export interface RelatorioCumprimento {
  linhas: LinhaCumprimento[];
  resumo: ResumoCumprimento;
  /** Quantas OS do período não tinham nenhum prazo a relatar (ficaram de fora da tabela) */
  semPrazo: number;
}

/**
 * O relatório do período: uma linha por OS/chamado que tenha ao menos um prazo já decidido. OS sem
 * nenhum prazo (nem de atendimento, nem de execução) não entra — não há o que relatar sobre ela —,
 * mas o total fica registrado para a tela poder dizer isso em voz alta.
 */
export async function relatorioCumprimento(
  empresaId: string, filtro: FiltroCumprimento, agora: Date = new Date(),
): Promise<RelatorioCumprimento> {
  const ordens = await prisma.ordemServico.findMany({
    where: whereCumprimento(empresaId, filtro),
    select: SELECT_CUMPRIMENTO,
    orderBy: [{ chamadoAbertoEm: "asc" }, { criadoEm: "asc" }],
    take: TETO_LINHAS,
  });
  const todas = ordens.map((os) => linhaDoCumprimento({
    ...os,
    clienteNome: os.cliente?.nomeFantasia || os.cliente?.nome || "—",
    contratoNumero: os.contrato?.numero ?? null,
  }, agora));
  const linhas = todas.filter(linhaRelata);
  return { linhas, resumo: resumoCumprimento(linhas), semPrazo: todas.length - linhas.length };
}

/** Cliente e contrato para o nome aparecer no cabeçalho do relatório e do PDF (sempre da empresa). */
export async function alvoDoRelatorio(empresaId: string, f: Pick<FiltroCumprimento, "clienteId" | "contratoId">) {
  const [cliente, contrato] = await Promise.all([
    f.clienteId ? prisma.cliente.findFirst({ where: { id: f.clienteId, empresaId }, select: { id: true, nome: true, nomeFantasia: true, cpfCnpj: true } }) : null,
    f.contratoId ? prisma.contrato.findFirst({ where: { id: f.contratoId, empresaId }, select: { id: true, numero: true } }) : null,
  ]);
  return { cliente, contrato };
}
