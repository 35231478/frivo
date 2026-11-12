/**
 * Reajuste anual do contrato (PR4, D8) no servidor: a lista "Reajustes a aplicar", o número do sino e as
 * três decisões (aplicar, adiar, dispensar). NADA aplica sozinho: só a pessoa (com "Contratos › Editar").
 *
 * Aplicar = numa transação com o contrato TRANCADO (FOR UPDATE):
 *  - confere que o aniversário ainda está pendente e que o valor do contrato é o que a pessoa viu;
 *  - grava a decisão no histórico (uma por contrato × ano: o índice único segura clique duplo/duas abas);
 *  - muda o valor do contrato.
 * Depois, a sincronização do PR1 leva o valor novo às previsões que ainda são só previsão, da competência
 * corrente em diante. Não é retroativo e não mexe no que já virou cobrança (medição, boleto, recebimento).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { partesBR } from "@/lib/fuso";
import { sincronizarPrevisoesDoContrato } from "@/lib/financeiro-server";
import {
  reajusteSugerivel, sugestaoReajuste, textoCompetencia, textoPercentual, type HojeReajuste, type SugestaoReajuste,
} from "@/lib/contratos/reajuste";
import { formatarMoeda } from "@/lib/utils";

export class ErroReajuste extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

export const hojeReajuste = (agora = new Date()): HojeReajuste => {
  const p = partesBR(agora);
  return { ano: p.ano, mes: p.mes + 1, dia: p.dia };
};

const CAMPOS = {
  id: true, numero: true, status: true, dataInicio: true, valorMensal: true, reajusteAtivo: true, reajusteIndice: true,
  reajustePercentual: true, reajusteMesAniversario: true, reajusteNotificar: true, reajusteNotificarDias: true, reajusteAdiadoAte: true,
} satisfies Prisma.ContratoSelect;

export type LinhaReajuste = SugestaoReajuste & {
  contratoId: string; numero: string; cliente: string;
};

/** Os anos de aniversário já decididos (aplicado ou dispensado), por contrato */
async function decididosPorContrato(contratoIds: string[]) {
  const decisoes = contratoIds.length
    ? await prisma.reajusteContrato.findMany({ where: { contratoId: { in: contratoIds }, anoReferencia: { not: null } }, select: { contratoId: true, anoReferencia: true } })
    : [];
  const mapa = new Map<string, number[]>();
  for (const d of decisoes) mapa.set(d.contratoId, [...(mapa.get(d.contratoId) ?? []), d.anoReferencia!]);
  return mapa;
}

/** "Reajustes a aplicar": pendentes primeiro, depois adiados e os que vêm chegando */
export async function listarReajustes(empresaId: string, agora = new Date()): Promise<LinhaReajuste[]> {
  const hoje = hojeReajuste(agora);
  const contratos = await prisma.contrato.findMany({
    where: { empresaId, status: "ATIVO", reajusteAtivo: true, reajusteIndice: "PERCENTUAL_FIXO" },
    select: { ...CAMPOS, cliente: { select: { nome: true, nomeFantasia: true } } },
    orderBy: { numero: "asc" },
  });
  const decididos = await decididosPorContrato(contratos.map((c) => c.id));
  const ordem = { PENDENTE: 0, ADIADO: 1, EM_BREVE: 2 } as const;
  return contratos
    .map((c) => {
      const s = sugestaoReajuste(c, decididos.get(c.id) ?? [], hoje);
      return s ? { ...s, contratoId: c.id, numero: c.numero, cliente: c.cliente.nomeFantasia ?? c.cliente.nome } : null;
    })
    .filter((l): l is LinhaReajuste => !!l)
    .sort((a, b) => ordem[a.situacao] - ordem[b.situacao] || a.aniversario.ano - b.aniversario.ano || a.aniversario.mes - b.aniversario.mes || a.numero.localeCompare(b.numero));
}

/** O número do sino: só os pendentes (adiado e "vem chegando" não tocam o sino) */
export async function contarReajustesPendentes(empresaId: string, agora = new Date()) {
  return (await listarReajustes(empresaId, agora)).filter((l) => l.situacao === "PENDENTE").length;
}

type Acao =
  | { acao: "APLICAR"; ano: number; valorEsperado: number }
  | { acao: "ADIAR"; ano: number; dias: number }
  | { acao: "DISPENSAR"; ano: number; motivo?: string | null };

/** A sugestão do contrato agora, trancado; erro se o aniversário pedido não está mais em aberto */
async function sugestaoTrancada(tx: Prisma.TransactionClient, empresaId: string, contratoId: string, ano: number, agora: Date) {
  const [trava] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM contratos WHERE id = ${contratoId} AND empresa_id = ${empresaId} FOR UPDATE`;
  if (!trava) throw new ErroReajuste("Contrato não encontrado.", 404);
  const c = await tx.contrato.findUniqueOrThrow({ where: { id: contratoId }, select: CAMPOS });
  if (!reajusteSugerivel(c)) throw new ErroReajuste("Este contrato não tem reajuste anual por percentual fixo ligado (ou não está ativo).");
  const decisoes = await tx.reajusteContrato.findMany({ where: { contratoId, anoReferencia: { not: null } }, select: { anoReferencia: true } });
  const s = sugestaoReajuste(c, decisoes.map((d) => d.anoReferencia!), hojeReajuste(agora));
  if (!s || s.aniversario.ano !== ano) throw new ErroReajuste("Este reajuste não está mais em aberto (alguém já decidiu ou o contrato mudou). Atualize a tela.");
  return { c, s };
}

export async function decidirReajuste(empresaId: string, contratoId: string, a: Acao, usuarioId: string, agora = new Date()) {
  if (a.acao === "ADIAR") {
    return prisma.$transaction(async (tx) => {
      const { s } = await sugestaoTrancada(tx, empresaId, contratoId, a.ano, agora);
      if (s.situacao === "EM_BREVE") throw new ErroReajuste("O aniversário ainda não chegou: não há o que adiar.");
      const h = hojeReajuste(agora);
      const ate = new Date(Date.UTC(h.ano, h.mes - 1, h.dia + a.dias));
      await tx.contrato.update({ where: { id: contratoId }, data: { reajusteAdiadoAte: ate } });
      return { situacao: "ADIADO" as const, adiadoAte: ate.toISOString().slice(0, 10) };
    });
  }

  if (a.acao === "DISPENSAR") {
    return prisma.$transaction(async (tx) => {
      const { c, s } = await sugestaoTrancada(tx, empresaId, contratoId, a.ano, agora);
      if (s.situacao === "EM_BREVE") throw new ErroReajuste("O aniversário ainda não chegou: dispense quando ele chegar.");
      await tx.reajusteContrato.create({
        data: {
          empresaId, contratoId, indice: "PERCENTUAL_FIXO", percentual: s.percentual, valorAnterior: s.valorAtual, valorNovo: s.valorAtual,
          anoReferencia: s.aniversario.ano, mesReferencia: s.aniversario.mes, situacao: "DISPENSADO", usuarioId, motivo: a.motivo?.trim() || null, data: agora,
        },
      });
      await tx.contrato.update({ where: { id: c.id }, data: { reajusteAdiadoAte: null } });
      return { situacao: "DISPENSADO" as const };
    }).catch(duplicado);
  }

  // APLICAR
  const feito = await prisma.$transaction(async (tx) => {
    const { s } = await sugestaoTrancada(tx, empresaId, contratoId, a.ano, agora);
    if (s.situacao === "EM_BREVE") throw new ErroReajuste(`O reajuste vale a partir de ${textoCompetencia(s.aniversario)}: aplique quando o aniversário chegar.`);
    if (Math.round(s.valorAtual * 100) !== Math.round(a.valorEsperado * 100)) {
      throw new ErroReajuste(`O valor do contrato mudou (agora ${formatarMoeda(s.valorAtual)}). Atualize a tela e confira o reajuste.`);
    }
    const antes = await tx.contrato.findUniqueOrThrow({ where: { id: contratoId } });
    await tx.reajusteContrato.create({
      data: {
        empresaId, contratoId, indice: "PERCENTUAL_FIXO", percentual: s.percentual, valorAnterior: s.valorAtual, valorNovo: s.valorNovo,
        anoReferencia: s.aniversario.ano, mesReferencia: s.aniversario.mes, situacao: "APLICADO", usuarioId, data: agora,
      },
    });
    await tx.contrato.update({ where: { id: contratoId }, data: { valorMensal: s.valorNovo, reajusteAdiadoAte: null } });
    return { antes, s };
  }).catch(duplicado);

  // As previsões que ainda são só previsão acompanham (da competência corrente em diante), com evento na linha do tempo
  const sinc = await sincronizarPrevisoesDoContrato(contratoId, feito.antes, usuarioId);
  return {
    situacao: "APLICADO" as const,
    valorAnterior: feito.s.valorAtual, valorNovo: feito.s.valorNovo, previsoesAtualizadas: sinc.atualizadas,
    texto: `Reajuste de ${textoPercentual(feito.s.percentual)} aplicado: ${formatarMoeda(feito.s.valorAtual)} → ${formatarMoeda(feito.s.valorNovo)}.`,
  };
}

/** Outra decisão do mesmo aniversário entrou primeiro (índice único) */
function duplicado(e: unknown): never {
  if ((e as { code?: string })?.code === "P2002") throw new ErroReajuste("Este reajuste já foi decidido por outra pessoa. Atualize a tela.");
  throw e;
}
