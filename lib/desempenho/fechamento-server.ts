/**
 * DESEMPENHO — FECHAMENTO do mês no servidor: a prévia, fechar, reabrir, a folha de bônus, o
 * histórico e a exportação. Tudo por empresa.
 *
 *  - FECHAR grava o painel do mês como está (com os valores) e uma linha da folha por colaborador.
 *    A partir daí o painel, a ficha e a tela do colaborador leem o que foi gravado: dado novo não muda
 *    mais o escore, a faixa nem o bônus daquele mês.
 *  - REABRIR não apaga nada: o fechamento fica "REABERTO" com quem, quando e por quê, e o mês volta a
 *    ser calculado ao vivo. Fechar de novo cria a versão seguinte.
 *  - Só o VALOR do bônus é registrado. Pagamento, imposto e encargo são do financeiro.
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { gerarCsv } from "@/lib/folha/planilha";
import { competenciaAtual } from "./regras";
import { ErroDesempenho, type Ator } from "./erros";
import {
  MSG_CONFIRMAR, MSG_FUTURO, MSG_JA_FECHADO, MSG_NADA_A_FECHAR, avisosDoFechamento, folhaDoPainel, lerPremios, linhasDoCsv, nomeDoArquivo, premiosDoMes,
  type Folha, type LinhaFolha, type PainelCongelado, type PremioFechado, type fecharSchema,
} from "./fechamento";
import { fechamentoVigente } from "./fechamento-estado";
import { ITENS_QUE_VALEM } from "./itens-validos";
import { sincronizarPenalidades } from "./penalidades-server";
import { MSG_INATIVO, desempenhoAtivo, painelAoVivo, premiacoesDoMes } from "./servidor";

export const MSG_FECHAMENTO_NAO_ENCONTRADO = "Fechamento não encontrado.";
export const MSG_JA_REABERTO = "Este fechamento já foi reaberto.";

/** Quem age, com o nome que fica gravado no registro */
export interface Autor extends Ator { nome: string }

const ehUnico = (e: unknown) => !!e && typeof e === "object" && (e as { code?: string }).code === "P2002";

/* ───────── leitura ───────── */

const SELECT_FECHAMENTO = {
  id: true, competencia: true, versao: true, situacao: true, totalBonus: true, fechadoEm: true, fechadoPorNome: true,
  reabertoEm: true, reabertoPorNome: true, reaberturaMotivo: true, premios: true,
} satisfies Prisma.DesempenhoFechamentoSelect;
type Linha = Prisma.DesempenhoFechamentoGetPayload<{ select: typeof SELECT_FECHAMENTO }>;

export interface FechamentoResumo {
  id: string; competencia: string; versao: number; situacao: "FECHADO" | "REABERTO"; total: number;
  fechadoEm: string; fechadoPor: string;
  reabertoEm: string | null; reabertoPor: string | null; reaberturaMotivo: string | null;
  premios: PremioFechado[];
}
const resumir = (f: Linha): FechamentoResumo => ({
  id: f.id, competencia: f.competencia, versao: f.versao, situacao: f.situacao === "REABERTO" ? "REABERTO" : "FECHADO", total: f.totalBonus.toNumber(),
  fechadoEm: f.fechadoEm.toISOString(), fechadoPor: f.fechadoPorNome,
  reabertoEm: f.reabertoEm?.toISOString() ?? null, reabertoPor: f.reabertoPorNome, reaberturaMotivo: f.reaberturaMotivo, premios: lerPremios(f.premios),
});

/** HISTÓRICO: todos os fechamentos da empresa (os reabertos também), do mês mais recente para o mais antigo. */
export async function historicoDeFechamentos(empresaId: string): Promise<FechamentoResumo[]> {
  const linhas = await prisma.desempenhoFechamento.findMany({ where: { empresaId }, orderBy: [{ competencia: "desc" }, { versao: "desc" }], take: 240, select: SELECT_FECHAMENTO });
  return linhas.map(resumir);
}

export interface FolhaDoFechamento extends FechamentoResumo { folha: Folha }

/** A folha de bônus de UM fechamento (o vigente ou um antigo): as linhas gravadas, na ordem do painel daquele mês. */
export async function folhaDoFechamento(empresaId: string, id: string): Promise<FolhaDoFechamento | null> {
  const f = await prisma.desempenhoFechamento.findFirst({
    where: { id, empresaId },
    select: { ...SELECT_FECHAMENTO, painel: true, linhas: { select: { tecnicoId: true, nome: true, perfil: true, posicao: true, escore: true, faixa: true, valor: true } } },
  });
  if (!f) return null;
  const ordemDoPerfil = new Map((f.painel as unknown as PainelCongelado).grupos.map((g, i) => [g.perfil.nome, i]));
  const linhas: LinhaFolha[] = f.linhas.map((l) => ({ ...l, escore: l.escore?.toNumber() ?? null, valor: l.valor.toNumber() }))
    .sort((a, b) => (ordemDoPerfil.get(a.perfil) ?? 99) - (ordemDoPerfil.get(b.perfil) ?? 99) || (a.posicao ?? 9999) - (b.posicao ?? 9999) || a.nome.localeCompare(b.nome, "pt-BR"));
  return { ...resumir(f), folha: { linhas, total: f.totalBonus.toNumber() } };
}

/** A folha de um fechamento em CSV (Excel brasileiro), para o financeiro. */
export async function csvDoFechamento(empresaId: string, id: string): Promise<{ arquivo: string; conteudo: string } | null> {
  const f = await folhaDoFechamento(empresaId, id);
  if (!f) return null;
  return { arquivo: nomeDoArquivo(f.competencia, f.versao), conteudo: gerarCsv(linhasDoCsv(f.competencia, f.folha, f.premios)) };
}

/* ───────── a prévia de um mês ───────── */

export interface PreviaDoFechamento {
  competencia: string;
  /** FECHADO = a folha é a gravada (definitiva); ABERTO = projeção calculada agora */
  situacao: "ABERTO" | "FECHADO";
  /** Por que não dá para fechar agora (null = dá) */
  bloqueio: string | null;
  /** O que a gestão precisa confirmar para fechar */
  avisos: string[];
  folha: Folha;
  premios: PremioFechado[];
  /** O fechamento que está valendo, quando o mês está fechado */
  fechamento: FechamentoResumo | null;
}

const pendentesDoMes = (empresaId: string, competencia: string) =>
  prisma.desempenhoPenalidade.count({ where: { empresaId, competencia, situacao: "A_REVISAR", ...ITENS_QUE_VALEM } });

async function aoVivo(empresaId: string, competencia: string): Promise<PainelCongelado> {
  const [painel, premiacoes] = await Promise.all([painelAoVivo(empresaId, competencia, true), premiacoesDoMes(empresaId, competencia)]);
  return { ...painel, premiacoes };
}

export async function previaDoFechamento(empresaId: string, competencia: string, agora: Date = new Date()): Promise<PreviaDoFechamento> {
  const vazia = { competencia, situacao: "ABERTO" as const, avisos: [], folha: { linhas: [], total: 0 }, premios: [], fechamento: null };
  if (!(await desempenhoAtivo(empresaId))) return { ...vazia, bloqueio: MSG_INATIVO };
  const vigente = await fechamentoVigente(empresaId, competencia);
  if (vigente) {
    const gravado = await folhaDoFechamento(empresaId, vigente.id);
    return { competencia, situacao: "FECHADO", bloqueio: MSG_JA_FECHADO, avisos: [], folha: gravado!.folha, premios: gravado!.premios, fechamento: gravado };
  }
  const atual = competenciaAtual(agora);
  if (competencia > atual) return { ...vazia, bloqueio: MSG_FUTURO };
  await sincronizarPenalidades(empresaId, agora);
  const [painel, pendentes] = await Promise.all([aoVivo(empresaId, competencia), pendentesDoMes(empresaId, competencia)]);
  const folha = folhaDoPainel(painel);
  return {
    competencia, situacao: "ABERTO", bloqueio: folha.linhas.length ? null : MSG_NADA_A_FECHAR, avisos: avisosDoFechamento(competencia, atual, pendentes),
    folha, premios: premiosDoMes(painel), fechamento: null,
  };
}

/* ───────── fechar e reabrir ───────── */

/**
 * FECHA o mês: congela o painel (escore, faixa e valor de cada colaborador) e grava a folha. Os avisos
 * (itens sem revisão, mês em andamento) precisam ser confirmados. Um mês só tem um fechamento valendo.
 */
export async function fecharMes(autor: Autor, d: z.infer<typeof fecharSchema>, agora: Date = new Date()): Promise<FolhaDoFechamento> {
  const { empresaId } = autor;
  const { competencia } = d;
  if (!(await desempenhoAtivo(empresaId))) throw new ErroDesempenho(MSG_INATIVO, 409);
  const atual = competenciaAtual(agora);
  if (competencia > atual) throw new ErroDesempenho(MSG_FUTURO, 409);
  if (await fechamentoVigente(empresaId, competencia)) throw new ErroDesempenho(MSG_JA_FECHADO, 409);

  // O que ainda não entrou na lista "a revisar" entra antes de fechar (depois, o mês não recebe item novo)
  await sincronizarPenalidades(empresaId, agora);
  const [painel, pendentes] = await Promise.all([aoVivo(empresaId, competencia), pendentesDoMes(empresaId, competencia)]);
  const folha = folhaDoPainel(painel);
  if (!folha.linhas.length) throw new ErroDesempenho(MSG_NADA_A_FECHAR, 409);
  const avisos = avisosDoFechamento(competencia, atual, pendentes);
  if (avisos.length && !d.ciente) throw new ErroDesempenho(`${avisos.join(" ")} ${MSG_CONFIRMAR}`, 409);
  const premios = premiosDoMes(painel);

  try {
    const id = await prisma.$transaction(async (tx) => {
      const anterior = await tx.desempenhoFechamento.aggregate({ where: { empresaId, competencia }, _max: { versao: true } });
      // A unicidade (empresa, mês, versão) é o que impede dois fechamentos ao mesmo tempo
      if (await tx.desempenhoFechamento.count({ where: { empresaId, competencia, situacao: "FECHADO" } })) throw new ErroDesempenho(MSG_JA_FECHADO, 409);
      const f = await tx.desempenhoFechamento.create({
        data: {
          empresaId, competencia, versao: (anterior._max.versao ?? 0) + 1, painel: painel as unknown as Prisma.InputJsonValue, premios: premios as unknown as Prisma.InputJsonValue,
          totalBonus: folha.total, fechadoPorId: autor.usuarioId, fechadoPorNome: autor.nome, fechadoEm: agora,
        },
        select: { id: true },
      });
      await tx.desempenhoFechamentoLinha.createMany({ data: folha.linhas.map((l) => ({ fechamentoId: f.id, empresaId, ...l })) });
      return f.id;
    });
    return (await folhaDoFechamento(empresaId, id))!;
  } catch (e) {
    if (ehUnico(e)) throw new ErroDesempenho(MSG_JA_FECHADO, 409);
    throw e;
  }
}

/** REABRE o mês: o fechamento fica registrado como "REABERTO" (quem, quando, por quê) e o mês volta a ser calculado. */
export async function reabrirMes(autor: Autor, id: string, motivo: string, agora: Date = new Date()): Promise<FechamentoResumo> {
  const f = await prisma.desempenhoFechamento.findFirst({ where: { id, empresaId: autor.empresaId }, select: { id: true } });
  if (!f) throw new ErroDesempenho(MSG_FECHAMENTO_NAO_ENCONTRADO, 404);
  // Só reabre o que está fechado (dois cliques não registram duas reaberturas)
  const { count } = await prisma.desempenhoFechamento.updateMany({
    where: { id, empresaId: autor.empresaId, situacao: "FECHADO" },
    data: { situacao: "REABERTO", reabertoPorId: autor.usuarioId, reabertoPorNome: autor.nome, reabertoEm: agora, reaberturaMotivo: motivo },
  });
  if (!count) throw new ErroDesempenho(MSG_JA_REABERTO, 409);
  return resumir(await prisma.desempenhoFechamento.findUniqueOrThrow({ where: { id }, select: SELECT_FECHAMENTO }));
}
