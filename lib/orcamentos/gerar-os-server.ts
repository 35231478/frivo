/**
 * "Gerar OS" a partir do orçamento aprovado — servidor. A empresa vem sempre de quem chama
 * (sessão). Sem duplicar: se o orçamento já gerou uma OS (ou já está vinculado a uma), devolve
 * essa; dois cliques simultâneos esbarram no ÚNICO de ordens_servico.orcamento_origem_id.
 * Não mexe em faturamento: a OS só recebe os itens (não executados) e o vínculo.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { criarPrimeiraAtividade, proximoNumeroOs, type ExecucaoPreparada } from "@/lib/os/abertura";
import { registrarEvento } from "@/lib/orcamentos/ciclo-server";
import { descricaoDaOs, itensParaOs, motivoNaoGerarOs } from "@/lib/orcamentos/gerar-os";

export interface OsResumo { id: string; numero: string }

/** A OS do orçamento: a que ele gerou ou, se não gerou, a primeira já vinculada a ele. */
export async function osDoOrcamento(empresaId: string, orcamentoId: string): Promise<(OsResumo & { gerada: boolean }) | null> {
  const gerada = await prisma.ordemServico.findFirst({ where: { empresaId, orcamentoOrigemId: orcamentoId }, select: { id: true, numero: true } });
  if (gerada) return { ...gerada, gerada: true };
  const vinculo = await prisma.orcamentoOs.findFirst({
    where: { orcamentoId, ordemServico: { empresaId } },
    orderBy: { ordemServico: { criadoEm: "asc" } },
    select: { ordemServico: { select: { id: true, numero: true } } },
  });
  return vinculo ? { ...vinculo.ordemServico, gerada: false } : null;
}

export type ResultadoGerarOs =
  | { tipo: "nao-encontrado" }
  | { tipo: "bloqueado"; erro: string }
  | { tipo: "existente"; os: OsResumo }
  | { tipo: "criada"; os: OsResumo };

const violouUnico = (e: unknown, campo: string) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && JSON.stringify(e.meta?.target ?? "").includes(campo);

export async function gerarOsDoOrcamento(p: { empresaId: string; usuarioId: string; orcamentoId: string; execucao: ExecucaoPreparada }): Promise<ResultadoGerarOs> {
  const { empresaId, usuarioId, orcamentoId } = p;
  const orc = await prisma.orcamento.findFirst({
    where: { id: orcamentoId, empresaId },
    select: {
      id: true, codigo: true, nome: true, descricao: true, status: true, tipo: true, clienteId: true, unidadeId: true,
      servicos: { select: { id: true, descricao: true, quantidade: true, valorUnitario: true, valorTotal: true, ordem: true } },
      produtos: { select: { descricao: true, quantidade: true, valorUnitario: true, valorTotal: true, ordem: true } },
    },
  });
  if (!orc) return { tipo: "nao-encontrado" };

  // Já tem OS (gerada ou vinculada): leva até ela, nunca cria outra
  const existente = await osDoOrcamento(empresaId, orc.id);
  if (existente) return { tipo: "existente", os: { id: existente.id, numero: existente.numero } };

  const motivo = motivoNaoGerarOs(orc);
  if (motivo) return { tipo: "bloqueado", erro: motivo };

  const itens = itensParaOs(orc.servicos, orc.produtos);
  // A numeração é "último + 1": numa corrida com outra OS nova, tenta o número seguinte
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const numero = await proximoNumeroOs(empresaId);
    try {
      const os = await prisma.$transaction(async (tx) => {
        const criada = await tx.ordemServico.create({
          data: {
            empresaId, numero, clienteId: orc.clienteId, unidadeId: orc.unidadeId, orcamentoOrigemId: orc.id,
            responsavelId: usuarioId, criadoPorId: usuarioId, status: "ABERTA", descricao: descricaoDaOs(orc),
          },
          select: { id: true, numero: true },
        });
        await criarPrimeiraAtividade(tx, empresaId, criada.id, p.execucao);
        if (itens.length) await tx.osItemOrcamento.createMany({ data: itens.map((i) => ({ ...i, ordemServicoId: criada.id })) });
        await tx.orcamentoOs.create({ data: { orcamentoId: orc.id, ordemServicoId: criada.id } });
        await tx.osHistorico.create({
          data: { ordemServicoId: criada.id, usuarioId, acao: "OS criada", detalhes: `Ordem de serviço ${numero} gerada a partir do orçamento ${orc.codigo}.` },
        });
        await registrarEvento({ empresaId, orcamentoId: orc.id, tipo: "OS_GERADA", detalhe: numero, usuarioId }, tx);
        return criada;
      });
      return { tipo: "criada", os };
    } catch (e) {
      // Outro clique gerou a OS deste orçamento no mesmo instante: devolve a dele
      if (violouUnico(e, "orcamento_origem_id")) {
        const ja = await osDoOrcamento(empresaId, orc.id);
        if (ja) return { tipo: "existente", os: { id: ja.id, numero: ja.numero } };
      }
      if (violouUnico(e, "numero") && tentativa < 2) continue;
      throw e;
    }
  }
  throw new Error("Não foi possível numerar a OS.");
}
