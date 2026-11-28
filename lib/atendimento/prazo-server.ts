/**
 * PRAZO DE ATENDIMENTO — o servidor: as promessas do contrato, os limites gravados na OS, o
 * comparecimento e o que pede atenção agora. As regras (contas, textos) moram em ./prazo.
 *
 *   • O contrato guarda UMA linha por prioridade. Salvar o contrato nunca toca em OS nenhuma: o que
 *     já foi prometido a um chamado fica como foi.
 *   • Os limites são gravados NA OS, pela promessa do contrato para a prioridade dela, contados desde
 *     a hora em que o cliente abriu o chamado. Isso acontece quando o contrato e a prioridade da OS
 *     ficam definidos (o aceite do chamado, a OS lançada como chamado) e de novo só quando a própria
 *     OS muda de contrato, de prioridade ou de hora de abertura.
 *   • "Só em horário comercial" usa a jornada semanal DA EMPRESA, lida na hora de fixar os limites:
 *     mudar a jornada depois não reescreve o que já foi prometido.
 *   • Comparecer = o primeiro "Cheguei" do app (reserva: o início da primeira atividade).
 */
import type { Prisma } from "@prisma/client";
import { comEscopo } from "@/lib/escopo/proprios";
import { prisma } from "@/lib/prisma";
import { STATUS_FINAIS_OS } from "@/lib/os/prazo-execucao";
import { alertaDoAtendimento, lerJornada, limitesDoAtendimento, regraDaPrioridade, temPrazoDeAtendimento, type FiltroAtendimento, type Jornada, type RegraAtendimento } from "./prazo";

type Db = Prisma.TransactionClient | typeof prisma;

/* ───────── as promessas do contrato ───────── */

export async function regrasDoContrato(db: Db, contratoId: string): Promise<RegraAtendimento[]> {
  const linhas = await db.contratoPrazoAtendimento.findMany({
    where: { contratoId }, select: { prioridade: true, comparecerHoras: true, resolverHoras: true, soHorarioComercial: true },
  });
  return linhas;
}

/** Troca as promessas do contrato pelas que vieram (lista vazia = o contrato não promete prazo). */
export async function salvarRegrasDoContrato(db: Db, empresaId: string, contratoId: string, regras: RegraAtendimento[]) {
  await db.contratoPrazoAtendimento.deleteMany({ where: { contratoId } });
  if (!regras.length) return;
  await db.contratoPrazoAtendimento.createMany({
    data: regras.map((r) => ({
      empresaId, contratoId, prioridade: r.prioridade as never, comparecerHoras: r.comparecerHoras, resolverHoras: r.resolverHoras, soHorarioComercial: r.soHorarioComercial,
    })),
  });
}

/* ───────── o horário comercial da empresa ───────── */

/** A jornada semanal da empresa (Configurações › Horário comercial); sem configurar, a padrão. */
export async function jornadaDaEmpresa(db: Db, empresaId: string): Promise<Jornada> {
  const config = await db.configuracao.findUnique({ where: { empresaId }, select: { horarioComercial: true } });
  return lerJornada(config?.horarioComercial);
}

/* ───────── os limites na OS ───────── */

const mesmo = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

/**
 * FIXA na OS os dois limites, pelo contrato e pela prioridade que ela tem agora. Sem chamado de
 * cliente em contrato (ou sem promessa para a prioridade), a OS fica sem prazo de atendimento.
 * Devolve os limites que ficaram gravados.
 */
export async function fixarLimitesDaOs(db: Db, osId: string): Promise<{ comparecerAte: Date | null; resolverAte: Date | null }> {
  const os = await db.ordemServico.findUnique({
    where: { id: osId },
    select: { empresaId: true, contratoId: true, origem: true, chamadoAbertoEm: true, prioridade: true, atendimentoComparecerAte: true, atendimentoResolverAte: true },
  });
  const vazio = { comparecerAte: null, resolverAte: null };
  if (!os) return vazio;
  let limites: { comparecerAte: Date | null; resolverAte: Date | null } = vazio;
  if (temPrazoDeAtendimento(os)) {
    const regra = regraDaPrioridade(await regrasDoContrato(db, os.contratoId!), os.prioridade);
    // A jornada só importa quando a promessa conta "só em horário comercial"
    const jornada = regra?.soHorarioComercial ? await jornadaDaEmpresa(db, os.empresaId) : undefined;
    limites = limitesDoAtendimento(os.chamadoAbertoEm!, regra, jornada);
  }
  if (!mesmo(limites.comparecerAte, os.atendimentoComparecerAte) || !mesmo(limites.resolverAte, os.atendimentoResolverAte)) {
    await db.ordemServico.update({ where: { id: osId }, data: { atendimentoComparecerAte: limites.comparecerAte, atendimentoResolverAte: limites.resolverAte } });
  }
  return limites;
}

/**
 * O técnico chegou: grava o comparecimento da OS. Só o PRIMEIRO vale — repetir (outra visita, outro
 * técnico, o início da atividade depois do "Cheguei") não troca a hora.
 */
export async function marcarComparecimento(db: Db, osId: string, em: Date): Promise<boolean> {
  const { count } = await db.ordemServico.updateMany({ where: { id: osId, atendimentoComparecidoEm: null }, data: { atendimentoComparecidoEm: em } });
  return count > 0;
}

/* ───────── o que pede atenção agora ───────── */

const SELECT_ALERTA = {
  id: true, status: true, chamadoAbertoEm: true, atendimentoComparecerAte: true, atendimentoResolverAte: true, atendimentoComparecidoEm: true, dataConclusao: true,
} satisfies Prisma.OrdemServicoSelect;

/**
 * Teto de leitura. "Vencendo" depende de uma fração do prazo de cada OS, que o banco não calcula:
 * as candidatas (OS abertas com limite ainda por cumprir) são lidas e classificadas aqui — os
 * chamados mais antigos primeiro, que são os que alertam, e nunca a tabela inteira.
 */
const TETO_CANDIDATAS = 2000;

/** As OS abertas com algum prazo de atendimento ainda por cumprir, já classificadas (a regra é a de ./prazo). */
async function emAlerta(empresaId: string, agora: Date, escopoOs: Prisma.OrdemServicoWhereInput = {}): Promise<{ id: string; alerta: "ESTOURADO" | "VENCENDO" }[]> {
  const abertas = await prisma.ordemServico.findMany({
    where: comEscopo({
      empresaId, status: { notIn: [...STATUS_FINAIS_OS] },
      OR: [{ atendimentoComparecerAte: { not: null }, atendimentoComparecidoEm: null }, { atendimentoResolverAte: { not: null } }],
    } as Prisma.OrdemServicoWhereInput, escopoOs),
    select: SELECT_ALERTA,
    orderBy: { chamadoAbertoEm: "asc" },
    take: TETO_CANDIDATAS,
  });
  return abertas.flatMap((os) => {
    const alerta = alertaDoAtendimento(os, agora);
    return alerta ? [{ id: os.id, alerta }] : [];
  });
}

/** Quantas OS estão com o prazo de atendimento vencendo e quantas já estouraram (para o sino e o Dashboard). */
/** `escopoOs`: COM-1 — com "Ver só os próprios", só as OS do escopo da pessoa. */
export async function contarAtendimento(empresaId: string, agora: Date = new Date(), escopoOs: Prisma.OrdemServicoWhereInput = {}): Promise<{ vencendo: number; estourado: number }> {
  const lista = await emAlerta(empresaId, agora, escopoOs);
  return { vencendo: lista.filter((x) => x.alerta === "VENCENDO").length, estourado: lista.filter((x) => x.alerta === "ESTOURADO").length };
}

/** As OS de um filtro da lista (`?atendimento=vencendo|estourado`) — as mesmas que o sino contou. */
export async function idsPorAtendimento(empresaId: string, filtro: FiltroAtendimento, agora: Date = new Date()): Promise<string[]> {
  const alvo = filtro === "estourado" ? "ESTOURADO" : "VENCENDO";
  return (await emAlerta(empresaId, agora)).filter((x) => x.alerta === alvo).map((x) => x.id);
}
