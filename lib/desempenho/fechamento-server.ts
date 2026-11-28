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
 *  - COM-1: a folha ganha a COMISSÃO de cada pessoa (as liberadas e ainda não pagas até o fim do mês). Fechar
 *    gera UMA conta a pagar por pessoa (bônus + comissão) e marca as comissões como pagas; reabrir cancela essas
 *    contas (só se nenhuma tiver pagamento) e devolve as comissões para "liberada". Empresa sem o programa de
 *    bônus usa o mesmo fechamento, só com as comissões.
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { gerarCsv } from "@/lib/folha/planilha";
import { proximoNumeroContaPagar } from "@/lib/financeiro-server";
import { comissoesDoMes, empresaUsaComissao, lancamentosDoTeto, movimentosAbertos, sincronizarComissoes, tetosAtivos, type ExcedenteDoMes } from "@/lib/comissoes/servidor";
import { competenciaAtual, competenciaCurta } from "./regras";
import { ErroDesempenho, type Ator } from "./erros";
import {
  MSG_CONFIRMAR, MSG_FUTURO, MSG_JA_FECHADO, MSG_NADA_A_FECHAR, avisosDoFechamento, folhaComComissoes, folhaDoPainel, lerPremios, linhasDoCsv, nomeDoArquivo, premiosDoMes, totalDaLinha,
  type Folha, type LinhaFolha, type PainelCongelado, type PremioFechado, type fecharSchema,
} from "./fechamento";
import { fechamentoVigente } from "./fechamento-estado";
import { ITENS_QUE_VALEM } from "./itens-validos";
import { sincronizarPenalidades } from "./penalidades-server";
import { MSG_INATIVO, desempenhoAtivo, painelAoVivo, premiacoesDoMes } from "./servidor";

export const MSG_FECHAMENTO_NAO_ENCONTRADO = "Fechamento não encontrado.";
export const MSG_JA_REABERTO = "Este fechamento já foi reaberto.";
export const MSG_NADA_A_FECHAR_COMISSAO = "Nenhuma comissão liberada até o fim deste mês: não há o que fechar.";
export const MSG_COMISSOES_MUDARAM = "As comissões do mês mudaram enquanto você fechava. Atualize a tela e feche de novo.";
export const MSG_CONTA_PAGA = (numero: string) => `A conta ${numero} já tem pagamento registrado: estorne o pagamento antes de reabrir o mês.`;

/** Quem age, com o nome que fica gravado no registro */
export interface Autor extends Ator { nome: string }

const ehUnico = (e: unknown) => !!e && typeof e === "object" && (e as { code?: string }).code === "P2002";

/* ───────── leitura ───────── */

const SELECT_FECHAMENTO = {
  id: true, competencia: true, versao: true, situacao: true, totalBonus: true, totalComissao: true, fechadoEm: true, fechadoPorNome: true,
  reabertoEm: true, reabertoPorNome: true, reaberturaMotivo: true, premios: true,
} satisfies Prisma.DesempenhoFechamentoSelect;
type Linha = Prisma.DesempenhoFechamentoGetPayload<{ select: typeof SELECT_FECHAMENTO }>;

export interface FechamentoResumo {
  id: string; competencia: string; versao: number; situacao: "FECHADO" | "REABERTO"; total: number;
  /** COM-1: soma das comissões do fechamento */
  totalComissao: number;
  fechadoEm: string; fechadoPor: string;
  reabertoEm: string | null; reabertoPor: string | null; reaberturaMotivo: string | null;
  premios: PremioFechado[];
}
const resumir = (f: Linha): FechamentoResumo => ({
  id: f.id, competencia: f.competencia, versao: f.versao, situacao: f.situacao === "REABERTO" ? "REABERTO" : "FECHADO", total: f.totalBonus.toNumber(), totalComissao: f.totalComissao.toNumber(),
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
    select: { ...SELECT_FECHAMENTO, painel: true, linhas: { select: { tecnicoId: true, nome: true, perfil: true, posicao: true, escore: true, faixa: true, valor: true, usuarioId: true, comissao: true, contaPagarId: true } } },
  });
  if (!f) return null;
  const ordemDoPerfil = new Map((f.painel as unknown as PainelCongelado).grupos.map((g, i) => [g.perfil.nome, i]));
  const linhas: LinhaFolha[] = f.linhas.map((l) => ({ ...l, escore: l.escore?.toNumber() ?? null, valor: l.valor.toNumber(), comissao: l.comissao.toNumber() }))
    .sort((a, b) => (ordemDoPerfil.get(a.perfil) ?? 99) - (ordemDoPerfil.get(b.perfil) ?? 99) || (a.posicao ?? 9999) - (b.posicao ?? 9999) || a.nome.localeCompare(b.nome, "pt-BR"));
  return { ...resumir(f), folha: { linhas, total: f.totalBonus.toNumber(), totalComissao: f.totalComissao.toNumber() } };
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
  /** COM-1: a empresa usa comissão (a folha mostra a coluna Comissão) */
  comissoes: boolean;
  /** O programa de bônus (Desempenho) está ligado */
  bonus: boolean;
}

const pendentesDoMes = (empresaId: string, competencia: string) =>
  prisma.desempenhoPenalidade.count({ where: { empresaId, competencia, situacao: "A_REVISAR", ...ITENS_QUE_VALEM } });

async function aoVivo(empresaId: string, competencia: string): Promise<PainelCongelado> {
  const [painel, premiacoes] = await Promise.all([painelAoVivo(empresaId, competencia, true), premiacoesDoMes(empresaId, competencia)]);
  return { ...painel, premiacoes };
}

/** Empresa sem o programa de bônus: o painel guardado no fechamento fica vazio (só as comissões entram na folha) */
const painelVazio = (competencia: string): PainelCongelado => ({ competencia, grupos: [], equipes: [], premiacoes: [] });

/** A folha ao vivo do mês: o bônus (com o programa ligado) + as comissões em aberto até o fim do mês */
async function folhaAoVivo(empresaId: string, competencia: string, o: { ativo: boolean; comissoes: boolean }, agora: Date) {
  if (o.ativo) await sincronizarPenalidades(empresaId, agora);
  const [painel, pendentes] = o.ativo ? await Promise.all([aoVivo(empresaId, competencia), pendentesDoMes(empresaId, competencia)]) : [painelVazio(competencia), 0];
  let folha = folhaDoPainel(painel);
  let idsComissao: string[] = [];
  let excedentes: ExcedenteDoMes[] = [];
  if (o.comissoes) {
    await sincronizarComissoes(empresaId, {}, agora);
    // COM-2: com teto, a pessoa recebe até o teto; o excedente vai para o mês seguinte (o par −/+ é gravado ao fechar)
    const doMes = comissoesDoMes(await movimentosAbertos(empresaId, competencia), await tetosAtivos(empresaId));
    folha = folhaComComissoes(folha, doMes.pessoas);
    idsComissao = doMes.ids;
    excedentes = doMes.excedentes;
  }
  return { painel, pendentes, folha, idsComissao, excedentes };
}

export async function previaDoFechamento(empresaId: string, competencia: string, agora: Date = new Date()): Promise<PreviaDoFechamento> {
  const [ativo, comissoes] = await Promise.all([desempenhoAtivo(empresaId), empresaUsaComissao(empresaId)]);
  const vazia = { competencia, situacao: "ABERTO" as const, avisos: [], folha: { linhas: [], total: 0 }, premios: [], fechamento: null, comissoes, bonus: ativo };
  if (!ativo && !comissoes) return { ...vazia, bloqueio: MSG_INATIVO };
  const vigente = await fechamentoVigente(empresaId, competencia);
  if (vigente) {
    const gravado = await folhaDoFechamento(empresaId, vigente.id);
    return { competencia, situacao: "FECHADO", bloqueio: MSG_JA_FECHADO, avisos: [], folha: gravado!.folha, premios: gravado!.premios, fechamento: gravado, comissoes, bonus: ativo };
  }
  const atual = competenciaAtual(agora);
  if (competencia > atual) return { ...vazia, bloqueio: MSG_FUTURO };
  const { painel, pendentes, folha } = await folhaAoVivo(empresaId, competencia, { ativo, comissoes }, agora);
  return {
    competencia, situacao: "ABERTO", bloqueio: folha.linhas.length ? null : ativo ? MSG_NADA_A_FECHAR : MSG_NADA_A_FECHAR_COMISSAO,
    avisos: avisosDoFechamento(competencia, atual, pendentes), folha, premios: premiosDoMes(painel), fechamento: null, comissoes, bonus: ativo,
  };
}

/** O vencimento da conta a pagar do fechamento: dia 5 do mês seguinte à competência (ou hoje, se já passou) */
export function vencimentoDoFechamento(competencia: string, agora: Date): Date {
  const [a, m] = competencia.split("-").map(Number);
  const dia5 = new Date(Date.UTC(m === 12 ? a + 1 : a, m === 12 ? 0 : m, 5));
  const hoje = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate()));
  return dia5 < hoje ? hoje : dia5;
}

/** A descrição da conta a pagar da pessoa: o que entrou nela (bônus, comissão ou os dois) e o mês */
export function descricaoDaConta(l: Pick<LinhaFolha, "valor" | "comissao">, competencia: string): string {
  const mes = competenciaCurta(competencia);
  if (l.valor > 0 && (l.comissao ?? 0) > 0) return `Bônus e comissões — ${mes}`;
  return (l.comissao ?? 0) > 0 ? `Comissões — ${mes}` : `Bônus do Desempenho — ${mes}`;
}

/* ───────── fechar e reabrir ───────── */

/**
 * FECHA o mês: congela o painel (escore, faixa e valor de cada colaborador) e grava a folha. Os avisos
 * (itens sem revisão, mês em andamento) precisam ser confirmados. Um mês só tem um fechamento valendo.
 */
export async function fecharMes(autor: Autor, d: z.infer<typeof fecharSchema>, agora: Date = new Date()): Promise<FolhaDoFechamento> {
  const { empresaId } = autor;
  const { competencia } = d;
  const [ativo, comissoes] = await Promise.all([desempenhoAtivo(empresaId), empresaUsaComissao(empresaId)]);
  if (!ativo && !comissoes) throw new ErroDesempenho(MSG_INATIVO, 409);
  const atual = competenciaAtual(agora);
  if (competencia > atual) throw new ErroDesempenho(MSG_FUTURO, 409);
  if (await fechamentoVigente(empresaId, competencia)) throw new ErroDesempenho(MSG_JA_FECHADO, 409);

  // O que ainda não entrou na lista "a revisar" entra antes de fechar (depois, o mês não recebe item novo);
  // as comissões são recalculadas pelo que aconteceu de fato (recebimentos, estornos, cancelamentos)
  const { painel, pendentes, folha, idsComissao, excedentes } = await folhaAoVivo(empresaId, competencia, { ativo, comissoes }, agora);
  if (!folha.linhas.length) throw new ErroDesempenho(ativo ? MSG_NADA_A_FECHAR : MSG_NADA_A_FECHAR_COMISSAO, 409);
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
          totalBonus: folha.total, totalComissao: folha.totalComissao ?? 0, fechadoPorId: autor.usuarioId, fechadoPorNome: autor.nome, fechadoEm: agora,
        },
        select: { id: true },
      });
      // As comissões do mês ficam PAGAS neste fechamento (se alguém mexeu nelas no meio, nada é gravado)
      if (idsComissao.length) {
        const { count } = await tx.comissaoLancamento.updateMany({ where: { id: { in: idsComissao }, empresaId, fechamentoId: null }, data: { fechamentoId: f.id } });
        if (count !== idsComissao.length) throw new ErroDesempenho(MSG_COMISSOES_MUDARAM, 409);
      }
      // COM-2: o teto — o excedente sai deste mês e entra no 1º dia do mês seguinte
      if (excedentes.length) await tx.comissaoLancamento.createMany({ data: lancamentosDoTeto(empresaId, competencia, f.id, excedentes) });
      // Uma linha da folha e UMA conta a pagar por pessoa (bônus + comissão)
      const vencimento = vencimentoDoFechamento(competencia, agora);
      for (const l of folha.linhas) {
        const linha = await tx.desempenhoFechamentoLinha.create({
          data: { fechamentoId: f.id, empresaId, tecnicoId: l.tecnicoId, nome: l.nome, perfil: l.perfil, posicao: l.posicao, escore: l.escore, faixa: l.faixa, valor: l.valor, usuarioId: l.usuarioId ?? null, comissao: l.comissao ?? 0 },
          select: { id: true },
        });
        const total = totalDaLinha(l);
        if (total <= 0) continue;
        const conta = await tx.contaPagar.create({
          data: {
            empresaId, numero: await proximoNumeroContaPagar(empresaId, tx), fornecedor: l.nome, tecnicoId: l.tecnicoId, descricao: descricaoDaConta(l, competencia),
            valorTotal: total, valorPago: 0, saldoRestante: total, status: "PENDENTE", dataVencimento: vencimento,
          },
          select: { id: true },
        });
        await tx.desempenhoFechamentoLinha.update({ where: { id: linha.id }, data: { contaPagarId: conta.id } });
      }
      return f.id;
    });
    return (await folhaDoFechamento(empresaId, id))!;
  } catch (e) {
    if (ehUnico(e)) throw new ErroDesempenho(MSG_JA_FECHADO, 409);
    throw e;
  }
}

export const MSG_TETO_JA_FECHADO = "O excedente do teto deste mês já entrou no fechamento do mês seguinte. Reabra aquele mês primeiro.";

/** REABRE o mês: o fechamento fica registrado como "REABERTO" (quem, quando, por quê) e o mês volta a ser calculado. */
export async function reabrirMes(autor: Autor, id: string, motivo: string, agora: Date = new Date()): Promise<FechamentoResumo> {
  const f = await prisma.desempenhoFechamento.findFirst({ where: { id, empresaId: autor.empresaId }, select: { id: true } });
  if (!f) throw new ErroDesempenho(MSG_FECHAMENTO_NAO_ENCONTRADO, 404);
  await prisma.$transaction(async (tx) => {
    // COM-1: as contas a pagar geradas ao fechar. Com pagamento registrado em alguma, não reabre (o dinheiro já saiu)
    const linhas = await tx.desempenhoFechamentoLinha.findMany({
      where: { fechamentoId: id, empresaId: autor.empresaId, contaPagarId: { not: null } },
      select: { contaPagar: { select: { id: true, numero: true, status: true, valorPago: true } } },
    });
    const contas = linhas.map((l) => l.contaPagar).filter((c): c is NonNullable<typeof c> => !!c);
    const paga = contas.find((c) => Number(c.valorPago) > 0 || c.status === "PAGO_PARCIAL" || c.status === "PAGO_TOTAL");
    if (paga) throw new ErroDesempenho(MSG_CONTA_PAGA(paga.numero), 409);
    // COM-2: o par do teto deste mês sai junto. Se o excedente já entrou no fechamento de um mês seguinte, reabra aquele antes
    const { competencia: compReaberta } = await tx.desempenhoFechamento.findUniqueOrThrow({ where: { id }, select: { competencia: true } });
    const parDoTeto = await tx.comissaoLancamento.findMany({ where: { empresaId: autor.empresaId, tetoCompetencia: compReaberta }, select: { id: true, fechamentoId: true } });
    if (parDoTeto.some((l) => l.fechamentoId && l.fechamentoId !== id)) throw new ErroDesempenho(MSG_TETO_JA_FECHADO, 409);
    if (parDoTeto.length) await tx.comissaoLancamento.deleteMany({ where: { id: { in: parDoTeto.map((l) => l.id) } } });
    // Só reabre o que está fechado (dois cliques não registram duas reaberturas)
    const { count } = await tx.desempenhoFechamento.updateMany({
      where: { id, empresaId: autor.empresaId, situacao: "FECHADO" },
      data: { situacao: "REABERTO", reabertoPorId: autor.usuarioId, reabertoPorNome: autor.nome, reabertoEm: agora, reaberturaMotivo: motivo },
    });
    if (!count) throw new ErroDesempenho(MSG_JA_REABERTO, 409);
    // As contas (sem pagamento) são canceladas; as comissões voltam a "liberada" e entram no próximo fechamento
    if (contas.length) {
      await tx.contaPagar.updateMany({
        where: { id: { in: contas.map((c) => c.id) }, empresaId: autor.empresaId, valorPago: 0 },
        data: { status: "CANCELADO", observacao: `Cancelada: o fechamento do mês ${competenciaCurta((await tx.desempenhoFechamento.findUniqueOrThrow({ where: { id }, select: { competencia: true } })).competencia)} foi reaberto.` },
      });
    }
    await tx.comissaoLancamento.updateMany({ where: { fechamentoId: id, empresaId: autor.empresaId }, data: { fechamentoId: null } });
  });
  return resumir(await prisma.desempenhoFechamento.findUniqueOrThrow({ where: { id }, select: SELECT_FECHAMENTO }));
}
