/**
 * PMOC — OCORRÊNCIAS (servidor): lê e grava as ocorrências do plano. As regras estão em
 * lib/pmoc-ocorrencias; aqui ficam o banco, a conferência dos vínculos (equipamento do PRÓPRIO plano,
 * OS do mesmo cliente e da mesma empresa), o anexo e a linha no histórico do plano.
 */
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dataISO, hojeISO } from "@/lib/pmoc";
import { paraData } from "@/lib/pmoc-server";
import { registrarHistorico } from "@/lib/pmoc-documento-server";
import { validarDataUrl } from "@/lib/anexos-server";
import {
  ACAO_EXCLUIDA, ACAO_RESTAURADA, MSG_ANEXO_GRANDE, MSG_ANEXO_TIPO, TAMANHO_MAX_ANEXO_OCORRENCIA, TIPOS_ANEXO_OCORRENCIA,
  acaoDaMudanca, detalheDaOcorrencia, erroDaOcorrencia, resolucaoGravada, rotuloDoEquipamento,
  type GravidadeOcorrencia, type OcorrenciaInput, type OcorrenciaPmoc, type OrdemDaOcorrencia, type SituacaoInput, type SituacaoOcorrencia,
} from "@/lib/pmoc-ocorrencias";

export class ErroOcorrencia extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export interface AtorOcorrencia { empresaId: string; usuarioId: string }

/** Para as rotas: o erro de regra vira a resposta com a mensagem; o resto sobe */
export async function responder<T>(fazer: () => Promise<T>, status = 200): Promise<NextResponse> {
  try { return NextResponse.json(await fazer(), { status }); }
  catch (e) {
    if (e instanceof ErroOcorrencia) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}

/** O que a lista traz — nunca o arquivo do anexo, só os metadados */
const SELECT_OCORRENCIA = {
  id: true, data: true, descricao: true, gravidade: true, situacao: true, resolvidaEm: true, resolucao: true, origem: true, ativo: true, criadoEm: true,
  anexoNome: true, anexoTipo: true, anexoTamanho: true, equipamentoId: true, ordemServicoId: true,
  equipamento: { select: { id: true, nome: true, marca: true, modelo: true, patrimonio: true } },
  ordemServico: { select: { id: true, numero: true } },
} satisfies Prisma.PmocOcorrenciaSelect;
type Linha = Prisma.PmocOcorrenciaGetPayload<{ select: typeof SELECT_OCORRENCIA }>;

export function serializarOcorrencia(o: Linha): OcorrenciaPmoc {
  return {
    id: o.id, data: dataISO(o.data)!, descricao: o.descricao, gravidade: o.gravidade as GravidadeOcorrencia, situacao: o.situacao as SituacaoOcorrencia,
    resolvidaEm: dataISO(o.resolvidaEm), resolucao: o.resolucao,
    equipamento: o.equipamento ? { id: o.equipamento.id, rotulo: rotuloDoEquipamento(o.equipamento), tag: o.equipamento.patrimonio } : null,
    ordemServico: o.ordemServico,
    anexo: o.anexoNome ? { nome: o.anexoNome, tipo: o.anexoTipo, tamanho: o.anexoTamanho } : null,
    origem: o.origem, ativo: o.ativo, criadoEm: o.criadoEm.toISOString(),
  };
}

/** O plano desta empresa (404) que aceita mudança (inativo: 409) */
async function planoDaOcorrencia(pmocId: string, empresaId: string) {
  const pmoc = await prisma.pmoc.findFirst({ where: { id: pmocId, empresaId }, select: { id: true, clienteId: true, ativo: true } });
  if (!pmoc) throw new ErroOcorrencia("PMOC não encontrado", 404);
  if (!pmoc.ativo) throw new ErroOcorrencia("PMOC inativo: reative antes de editar.", 409);
  return pmoc;
}

/** A ocorrência DESTE plano (404); a excluída só aceita ser restaurada (409) */
async function ocorrenciaDoPlano(pmocId: string, id: string, op: { aceitaExcluida?: boolean } = {}) {
  const atual = await prisma.pmocOcorrencia.findFirst({ where: { id, pmocId }, select: { ...SELECT_OCORRENCIA, resolvidaPorId: true } });
  if (!atual) throw new ErroOcorrencia("Ocorrência não encontrada", 404);
  if (!atual.ativo && !op.aceitaExcluida) throw new ErroOcorrencia("Ocorrência excluída: restaure antes de editar.", 409);
  return atual;
}

/** Equipamento que está NESTE plano e OS do mesmo cliente; o que já estava gravado não é conferido de novo */
async function conferirVinculos(pmoc: { id: string; clienteId: string }, empresaId: string, d: { equipamentoId: string | null; ordemServicoId: string | null }, atual?: { equipamentoId: string | null; ordemServicoId: string | null }) {
  if (d.equipamentoId && d.equipamentoId !== atual?.equipamentoId) {
    const noPlano = await prisma.pmocEquipamento.findFirst({ where: { pmocId: pmoc.id, equipamentoId: d.equipamentoId }, select: { id: true } });
    if (!noPlano) throw new ErroOcorrencia("Este equipamento não está no PMOC. Inclua-o na aba Equipamentos AVAC.");
  }
  if (d.ordemServicoId && d.ordemServicoId !== atual?.ordemServicoId) {
    const os = await prisma.ordemServico.findFirst({ where: { id: d.ordemServicoId, empresaId }, select: { clienteId: true } });
    if (!os) throw new ErroOcorrencia("OS inválida.");
    if (os.clienteId !== pmoc.clienteId) throw new ErroOcorrencia("Esta OS é de outro cliente.");
  }
}

/** Dados do anexo a partir do pedido: troca, remove ou mantém ({}). O tipo gravado é o do CONTEÚDO. */
export function dadosDoAnexo(d: Pick<OcorrenciaInput, "anexo" | "anexoNome" | "removerAnexo">) {
  if (d.removerAnexo) return { anexo: null, anexoNome: null, anexoTipo: null, anexoTamanho: null };
  if (!d.anexo) return {};
  const nome = (d.anexoNome ?? "").trim() || "anexo";
  const r = validarDataUrl(d.anexo, nome, { tipos: TIPOS_ANEXO_OCORRENCIA, tamanhoMax: TAMANHO_MAX_ANEXO_OCORRENCIA, mensagemTipo: MSG_ANEXO_TIPO });
  if (!r.ok) {
    const grande = /muito grande/.test(r.erro);
    throw new ErroOcorrencia(grande ? MSG_ANEXO_GRANDE : r.erro, grande ? 413 : 400);
  }
  return { anexo: r.arquivo.conteudo, anexoNome: r.arquivo.nome.slice(0, 200), anexoTipo: r.arquivo.tipo, anexoTamanho: r.arquivo.tamanho };
}

const paraDataOpcional = (iso: string | null) => (iso ? paraData(iso) : null);
const detalhe = (o: Linha) => detalheDaOcorrencia({ gravidade: o.gravidade, descricao: o.descricao, equipamento: o.equipamento ? rotuloDoEquipamento(o.equipamento) : null });

/* ───────── leitura ───────── */

export interface OcorrenciasDoPlano { ocorrencias: OcorrenciaPmoc[]; ordens: OrdemDaOcorrencia[] }

/**
 * As ocorrências do plano, com as excluídas (a tela separa). `comOrdens`: as OS do cliente que o
 * formulário oferece para ligar — só vão para quem pode editar. null = plano não existe nesta empresa.
 */
export async function ocorrenciasDoPlano(pmocId: string, empresaId: string, comOrdens: boolean): Promise<OcorrenciasDoPlano | null> {
  const pmoc = await prisma.pmoc.findFirst({ where: { id: pmocId, empresaId }, select: { id: true, clienteId: true } });
  if (!pmoc) return null;
  const [linhas, ordens] = await Promise.all([
    prisma.pmocOcorrencia.findMany({ where: { pmocId: pmoc.id }, orderBy: [{ data: "desc" }, { criadoEm: "desc" }], select: SELECT_OCORRENCIA }),
    comOrdens
      ? prisma.ordemServico.findMany({ where: { empresaId, clienteId: pmoc.clienteId }, orderBy: { criadoEm: "desc" }, take: 150, select: { id: true, numero: true, descricao: true } })
      : Promise.resolve([]),
  ]);
  return { ocorrencias: linhas.map(serializarOcorrencia), ordens: ordens.map((o) => ({ id: o.id, numero: o.numero, descricao: o.descricao.replace(/\s+/g, " ").trim().slice(0, 80) })) };
}

/** O arquivo do anexo (null = plano, ocorrência ou anexo não existe nesta empresa) */
export async function anexoDaOcorrencia(pmocId: string, id: string, empresaId: string): Promise<{ nome: string; conteudo: string } | null> {
  const o = await prisma.pmocOcorrencia.findFirst({ where: { id, pmocId, pmoc: { empresaId } }, select: { anexo: true, anexoNome: true } });
  return o?.anexo ? { nome: o.anexoNome ?? "anexo", conteudo: o.anexo } : null;
}

/** Quantas ocorrências do plano ainda não foram resolvidas (o número da aba) */
export function ocorrenciasPendentes(pmocId: string): Promise<number> {
  return prisma.pmocOcorrencia.count({ where: { pmocId, ativo: true, situacao: { not: "RESOLVIDA" } } });
}

/* ───────── escrita ───────── */

export async function criarOcorrencia(pmocId: string, ator: AtorOcorrencia, d: OcorrenciaInput, hoje = hojeISO()): Promise<OcorrenciaPmoc> {
  const pmoc = await planoDaOcorrencia(pmocId, ator.empresaId);
  const erro = erroDaOcorrencia(d, hoje);
  if (erro) throw new ErroOcorrencia(erro);
  await conferirVinculos(pmoc, ator.empresaId, d);
  const fim = resolucaoGravada(d, hoje);
  return prisma.$transaction(async (tx) => {
    const o = await tx.pmocOcorrencia.create({
      data: {
        empresaId: ator.empresaId, pmocId: pmoc.id, equipamentoId: d.equipamentoId, ordemServicoId: d.ordemServicoId, data: paraData(d.data), descricao: d.descricao,
        gravidade: d.gravidade, situacao: d.situacao, resolvidaEm: paraDataOpcional(fim.resolvidaEm), resolucao: fim.resolucao,
        resolvidaPorId: d.situacao === "RESOLVIDA" ? ator.usuarioId : null, criadoPorId: ator.usuarioId, ...dadosDoAnexo(d),
      },
      select: SELECT_OCORRENCIA,
    });
    await registrarHistorico(tx, { pmocId: pmoc.id, usuarioId: ator.usuarioId, acao: acaoDaMudanca(null, o.situacao), detalhes: detalhe(o) });
    return serializarOcorrencia(o);
  });
}

export async function atualizarOcorrencia(pmocId: string, id: string, ator: AtorOcorrencia, d: OcorrenciaInput, hoje = hojeISO()): Promise<OcorrenciaPmoc> {
  const pmoc = await planoDaOcorrencia(pmocId, ator.empresaId);
  const atual = await ocorrenciaDoPlano(pmoc.id, id);
  const erro = erroDaOcorrencia(d, hoje);
  if (erro) throw new ErroOcorrencia(erro);
  await conferirVinculos(pmoc, ator.empresaId, d, atual);
  const fim = resolucaoGravada(d, hoje);
  return prisma.$transaction(async (tx) => {
    const o = await tx.pmocOcorrencia.update({
      where: { id: atual.id },
      data: {
        equipamentoId: d.equipamentoId, ordemServicoId: d.ordemServicoId, data: paraData(d.data), descricao: d.descricao, gravidade: d.gravidade, situacao: d.situacao,
        resolvidaEm: paraDataOpcional(fim.resolvidaEm), resolucao: fim.resolucao,
        // Quem resolveu: fica quem já tinha resolvido; some ao reabrir
        resolvidaPorId: d.situacao !== "RESOLVIDA" ? null : atual.situacao === "RESOLVIDA" ? atual.resolvidaPorId : ator.usuarioId,
        ...dadosDoAnexo(d),
      },
      select: SELECT_OCORRENCIA,
    });
    await registrarHistorico(tx, { pmocId: pmoc.id, usuarioId: ator.usuarioId, acao: acaoDaMudanca(atual.situacao, o.situacao), detalhes: detalhe(o) });
    return serializarOcorrencia(o);
  });
}

/** O "Resolver", o "Em andamento" e o "Reabrir": só a situação muda */
export async function mudarSituacao(pmocId: string, id: string, ator: AtorOcorrencia, d: SituacaoInput, hoje = hojeISO()): Promise<OcorrenciaPmoc> {
  const pmoc = await planoDaOcorrencia(pmocId, ator.empresaId);
  const atual = await ocorrenciaDoPlano(pmoc.id, id);
  const datas = { ...d, data: dataISO(atual.data)! };
  const erro = erroDaOcorrencia(datas, hoje);
  if (erro) throw new ErroOcorrencia(erro);
  const fim = resolucaoGravada(datas, hoje);
  return prisma.$transaction(async (tx) => {
    const o = await tx.pmocOcorrencia.update({
      where: { id: atual.id },
      data: {
        situacao: d.situacao, resolvidaEm: paraDataOpcional(fim.resolvidaEm), resolucao: fim.resolucao,
        resolvidaPorId: d.situacao !== "RESOLVIDA" ? null : atual.situacao === "RESOLVIDA" ? atual.resolvidaPorId : ator.usuarioId,
      },
      select: SELECT_OCORRENCIA,
    });
    const acao = acaoDaMudanca(atual.situacao, o.situacao);
    const obs = acao === "Ocorrência resolvida" && o.resolucao ? ` Resolução: ${o.resolucao.replace(/\s+/g, " ")}` : "";
    await registrarHistorico(tx, { pmocId: pmoc.id, usuarioId: ator.usuarioId, acao, detalhes: `${detalhe(o)}${obs}`.slice(0, 400) });
    return serializarOcorrencia(o);
  });
}

/** Excluir = guardar fora da lista e do documento (`ativo: false`); restaurar desfaz */
export async function excluirOuRestaurar(pmocId: string, id: string, ator: AtorOcorrencia, ativo: boolean): Promise<OcorrenciaPmoc> {
  const pmoc = await planoDaOcorrencia(pmocId, ator.empresaId);
  const atual = await ocorrenciaDoPlano(pmoc.id, id, { aceitaExcluida: true });
  if (atual.ativo === ativo) return serializarOcorrencia(atual);
  return prisma.$transaction(async (tx) => {
    const o = await tx.pmocOcorrencia.update({ where: { id: atual.id }, data: { ativo }, select: SELECT_OCORRENCIA });
    await registrarHistorico(tx, { pmocId: pmoc.id, usuarioId: ator.usuarioId, acao: ativo ? ACAO_RESTAURADA : ACAO_EXCLUIDA, detalhes: detalhe(o) });
    return serializarOcorrencia(o);
  });
}
