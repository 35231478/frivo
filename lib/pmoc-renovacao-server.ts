/**
 * PMOC — RENOVAÇÃO anual (servidor): lê o plano de origem, monta a prévia do diálogo e cria o plano
 * novo. As regras (o que vai, o que fica, para onde vai cada data) são as de lib/pmoc-renovacao.
 */
import { prisma } from "@/lib/prisma";
import { dataBR, dataISO } from "@/lib/pmoc";
import { paraData } from "@/lib/pmoc-server";
import { registrarHistorico } from "@/lib/pmoc-documento-server";
import {
  PREFIXO_RENOVACAO_GERADA, acaoRenovacaoGerada, acaoRenovadoDe, comReferencia, lerReferencia, nomeDaRenovacao, planejarRenovacao, resumoDoQueFoi, vigenciaProposta,
  type ItemDeOrigem, type OrigemRenovacao, type PlanoRenovacao, type RenovacaoInput, type Vigencia,
} from "@/lib/pmoc-renovacao";

/** Um item do cronograma de origem, com o que o diálogo mostra dele */
export interface ItemDaPrevia extends ItemDeOrigem { servico: string; aplicaA: string }
export interface PreviaRenovacao {
  pmoc: { id: string; nome: string } & Vigencia;
  /** O que o diálogo propõe; nome e datas podem ser mudados antes de confirmar */
  proposta: { nome: string } & Vigencia;
  equipamentos: { id: string; rotulo: string; ativo: boolean }[];
  itens: ItemDaPrevia[];
  /** Renovações já geradas a partir deste plano que continuam ativas */
  renovacoes: { id: string; nome: string }[];
}

const SELECT_ORIGEM = {
  id: true, nome: true, descricao: true, clienteId: true, unidadeId: true, dataInicio: true, dataExpiracao: true,
  responsavelTecnicoId: true, rtNome: true, rtCrea: true,
  equipamentos: { select: { equipamento: { select: { id: true, ativo: true, nome: true, marca: true, modelo: true, patrimonio: true } } } },
  cronograma: {
    orderBy: { criadoEm: "asc" },
    select: {
      id: true, ativo: true, tipoEquipamentoId: true, equipamentoId: true, tipoOsId: true, dataInicio: true, intervaloMeses: true, diaExecucao: true,
      fimSemana: true, criadoEm: true,
      tipoOs: { select: { nome: true } }, tipoEquipamento: { select: { nome: true } },
      equipamento: { select: { nome: true, marca: true, modelo: true, patrimonio: true } },
    },
  },
} as const;

type Equip = { nome: string | null; marca: string; modelo: string; patrimonio: string | null };
const rotuloEquipamento = (e: Equip) => [e.patrimonio, e.nome || `${e.marca} ${e.modelo}`.trim()].filter(Boolean).join(" · ");

async function carregarOrigem(pmocId: string, empresaId: string) {
  const p = await prisma.pmoc.findFirst({ where: { id: pmocId, empresaId }, select: SELECT_ORIGEM });
  if (!p) return null;
  const vigencia: Vigencia = { dataInicio: dataISO(p.dataInicio)!, dataExpiracao: dataISO(p.dataExpiracao)! };
  const itens: ItemDaPrevia[] = p.cronograma.map((i) => ({
    id: i.id, ativo: i.ativo, tipoEquipamentoId: i.tipoEquipamentoId, equipamentoId: i.equipamentoId, tipoOsId: i.tipoOsId,
    dataInicio: dataISO(i.dataInicio)!, intervaloMeses: i.intervaloMeses, diaExecucao: i.diaExecucao, fimSemana: i.fimSemana, criadoEm: i.criadoEm.toISOString(),
    servico: i.tipoOs.nome,
    aplicaA: i.equipamento ? rotuloEquipamento(i.equipamento) : i.tipoEquipamento ? i.tipoEquipamento.nome : "Todos os equipamentos",
  }));
  const equipamentos = p.equipamentos.map((v) => ({ id: v.equipamento.id, ativo: v.equipamento.ativo, rotulo: rotuloEquipamento(v.equipamento) }));
  const origem: OrigemRenovacao = { pmoc: vigencia, equipamentos, itens };
  return { p, vigencia, itens, equipamentos, origem };
}

/** Planos ativos desta empresa já gerados como renovação deste (pela linha do histórico) */
async function renovacoesDoPlano(pmocId: string, empresaId: string): Promise<{ id: string; nome: string }[]> {
  const linhas = await prisma.pmocHistorico.findMany({ where: { pmocId, acao: { startsWith: PREFIXO_RENOVACAO_GERADA } }, select: { detalhes: true }, orderBy: { criadoEm: "asc" } });
  const ids = [...new Set(linhas.map((l) => lerReferencia(l.detalhes).pmocId).filter((id): id is string => !!id))];
  if (!ids.length) return [];
  return prisma.pmoc.findMany({ where: { id: { in: ids }, empresaId, ativo: true }, select: { id: true, nome: true }, orderBy: { criadoEm: "asc" } });
}

/** O que o diálogo "Renovar" mostra (null = o plano não existe nesta empresa) */
export async function previaDaRenovacao(pmocId: string, empresaId: string): Promise<PreviaRenovacao | null> {
  const o = await carregarOrigem(pmocId, empresaId);
  if (!o) return null;
  const nova = vigenciaProposta(o.vigencia.dataExpiracao);
  return {
    pmoc: { id: o.p.id, nome: o.p.nome, ...o.vigencia },
    proposta: { nome: nomeDaRenovacao(o.p.nome, o.vigencia, nova), ...nova },
    equipamentos: o.equipamentos,
    itens: o.itens.filter((i) => i.ativo),
    renovacoes: await renovacoesDoPlano(pmocId, empresaId),
  };
}

export interface ResultadoRenovacao { id: string; plano: PlanoRenovacao }

/**
 * Cria o plano novo, em RASCUNHO, com os equipamentos ativos e o cronograma deslocado, e liga os
 * dois planos pelo histórico. Tudo numa transação. Não leva ART, link público, histórico, avisos nem
 * execuções: nada disso é lido do plano de origem. Devolve null se o plano não é desta empresa.
 */
export async function renovarPmoc(pmocId: string, ator: { empresaId: string; usuarioId: string }, d: RenovacaoInput, agora: Date = new Date()): Promise<ResultadoRenovacao | null> {
  const o = await carregarOrigem(pmocId, ator.empresaId);
  if (!o) return null;
  const nova: Vigencia = { dataInicio: d.dataInicio, dataExpiracao: d.dataExpiracao };
  const plano = planejarRenovacao(o.origem, nova);
  const id = await prisma.$transaction(async (tx) => {
    const novo = await tx.pmoc.create({
      data: {
        empresaId: ator.empresaId, criadoPorId: ator.usuarioId, status: "RASCUNHO",
        nome: d.nome, descricao: o.p.descricao, clienteId: o.p.clienteId, unidadeId: o.p.unidadeId,
        dataInicio: paraData(d.dataInicio), dataExpiracao: paraData(d.dataExpiracao),
        responsavelTecnicoId: o.p.responsavelTecnicoId, rtNome: o.p.rtNome, rtCrea: o.p.rtCrea,
        equipamentos: { create: plano.equipamentoIds.map((equipamentoId) => ({ equipamentoId })) },
      },
      select: { id: true },
    });
    if (plano.itens.length) {
      await tx.pmocCronograma.createMany({
        // `criadoEm` um milissegundo depois do outro: a ordem de criação (o desempate da substituição) é a do plano de origem
        data: plano.itens.map((i, n) => ({
          pmocId: novo.id, tipoEquipamentoId: i.tipoEquipamentoId, equipamentoId: i.equipamentoId, tipoOsId: i.tipoOsId,
          dataInicio: paraData(i.dataInicio), intervaloMeses: i.intervaloMeses, diaExecucao: i.diaExecucao, fimSemana: i.fimSemana,
          criadoEm: new Date(agora.getTime() + n),
        })),
      });
    }
    await registrarHistorico(tx, {
      pmocId: novo.id, usuarioId: ator.usuarioId, acao: acaoRenovadoDe(o.p.nome),
      detalhes: comReferencia(`Vigência anterior: ${dataBR(o.vigencia.dataInicio)} a ${dataBR(o.vigencia.dataExpiracao)}. ${resumoDoQueFoi(plano)}`, o.p.id),
    });
    await registrarHistorico(tx, {
      pmocId: o.p.id, usuarioId: ator.usuarioId, acao: acaoRenovacaoGerada(d.nome),
      detalhes: comReferencia(`Nova vigência: ${dataBR(d.dataInicio)} a ${dataBR(d.dataExpiracao)}. O plano novo nasce em rascunho.`, novo.id),
    });
    return novo.id;
  });
  return { id, plano };
}
