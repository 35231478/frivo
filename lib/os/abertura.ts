/**
 * Abertura de OS — o que toda OS nova precisa, venha da tela "Nova OS" ou do "Gerar OS" do
 * orçamento aprovado: quem executa (obrigatório) e o veículo na 1ª atividade, e o número
 * OS-AAAA-NNNN. A empresa vem sempre de quem chama (sessão).
 */
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ErroTecnicos, MSG_SEM_EXECUTOR, gravarTecnicos, lerDefinicao, lerVeiculo, resolverTecnicos, resolverVeiculo } from "@/lib/atividade-tecnicos";
import { proximoNumero } from "@/lib/numeracao-server";

/** 1ª atividade da OS — é nela que fica QUEM EXECUTA (obrigatório) e o veículo. */
export const execucaoSchema = z.object({
  titulo: z.string().optional(),
  tipoOsId: z.string().optional().nullable(),
  dataAgendada: z.string().optional().nullable(),
  duracaoMin: z.number().int().positive().optional().nullable(),
});

export interface ExecucaoPreparada {
  titulo: string;
  tipoOsId: string | null;
  dataAgendada: Date | null;
  duracaoMin: number | null;
  tecnicos: Awaited<ReturnType<typeof resolverTecnicos>>;
  veiculoId: string | null;
}

/** Valida o bloco `execucao` do corpo (tipo de OS, data, equipe/colaboradores, veículo) contra a empresa. */
export async function prepararExecucao(empresaId: string, exec: unknown): Promise<{ erro: string } | { execucao: ExecucaoPreparada }> {
  const parsed = execucaoSchema.safeParse(exec ?? {});
  const def = lerDefinicao(exec);
  if (!exec || !parsed.success || !def) return { erro: MSG_SEM_EXECUTOR };
  const tipoOsId = parsed.data.tipoOsId || null;
  const tipoOs = tipoOsId ? await prisma.tipoOs.findFirst({ where: { id: tipoOsId, empresaId }, select: { id: true, nome: true } }) : null;
  if (tipoOsId && !tipoOs) return { erro: "Tipo de OS inválido." };
  const dataAgendada = parsed.data.dataAgendada ? new Date(parsed.data.dataAgendada) : null;
  if (dataAgendada && Number.isNaN(dataAgendada.getTime())) return { erro: "Data agendada inválida." };
  try {
    const tecnicos = await resolverTecnicos(empresaId, def, tipoOsId, { exigir: true });
    const veiculoId = await resolverVeiculo(empresaId, lerVeiculo(exec), tecnicos);
    return {
      execucao: {
        titulo: parsed.data.titulo?.trim() || tipoOs?.nome || "Atendimento",
        tipoOsId, dataAgendada, duracaoMin: parsed.data.duracaoMin ?? null, tecnicos, veiculoId,
      },
    };
  } catch (e) {
    if (e instanceof ErroTecnicos) return { erro: e.message };
    throw e;
  }
}

/**
 * Próximo número da OS (OS-AAAA-NNNN) pelo contador da empresa (Configurações › Numeração de
 * documentos), sob trava e dentro da transação de quem grava: numeração contínua, nunca duplica.
 * `ano` = o de hoje em Brasília ou o da competência (OS recorrente).
 */
export const proximoNumeroOs = (tx: Prisma.TransactionClient, empresaId: string) => proximoNumero(tx, empresaId, "os");

/** Cria a 1ª atividade (agendada) com quem executa; devolve o id dela. */
export async function criarPrimeiraAtividade(tx: Prisma.TransactionClient, empresaId: string, ordemServicoId: string, e: ExecucaoPreparada) {
  const atividade = await tx.atividadeOs.create({
    data: {
      empresaId, ordemServicoId, tipoOsId: e.tipoOsId, titulo: e.titulo,
      tecnicoId: e.tecnicos.responsavel, veiculoId: e.veiculoId, dataAgendada: e.dataAgendada, duracaoMin: e.duracaoMin,
      status: "AGENDADA",
    },
    select: { id: true },
  });
  await gravarTecnicos(tx, atividade.id, e.tecnicos);
  return atividade.id;
}
