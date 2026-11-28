/**
 * PAUSAR / IMPEDIMENTO — o servidor: os motivos da empresa (os padrões nascem na 1ª leitura), pausar, retomar e
 * encerrar a visita como "Não concluída — precisa voltar". Tudo idempotente: o aparelho manda o mesmo pedido de novo
 * (sem sinal, depois de fechar o app) e nada se repete. As regras puras estão em lib/pausas/regras.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { momentoDaConclusao, type RelogioDaConclusao } from "@/lib/os/conclusao-atividade";
import { sincronizarStatusOs } from "@/lib/os/sincronizar-status";
import type { ContextoExecucao } from "@/lib/execucao/contexto";
import {
  MOTIVOS_PADRAO, MSG_JA_PAUSADA, MSG_NAO_EM_ANDAMENTO, MSG_NAO_PAUSADA, MSG_SO_IMPEDIMENTO, MSG_TEXTO_OBRIGATORIO,
  textoNaoConcluida, type MotivoPausaTela, type TipoMotivo,
} from "@/lib/pausas/regras";

type Resultado = { ok: true; status: number; dados: Record<string, unknown> } | { ok: false; status: number; erro: string };
const ok = (dados: Record<string, unknown>, status = 200): Resultado => ({ ok: true, status, dados });
const erro = (status: number, mensagem: string): Resultado => ({ ok: false, status, erro: mensagem });
const ehDuplicado = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** Os motivos da empresa, na ordem; a 1ª leitura cria os padrões (a empresa edita, inativa e cria outros depois) */
export async function motivosDaEmpresa(empresaId: string, o: { inativos?: boolean } = {}): Promise<(MotivoPausaTela & { ativo: boolean; ordem: number })[]> {
  const ler = () => prisma.motivoPausa.findMany({
    where: { empresaId, ...(o.inativos ? {} : { ativo: true }) }, orderBy: [{ ordem: "asc" }, { nome: "asc" }],
    select: { id: true, nome: true, tipo: true, pedeTexto: true, ativo: true, ordem: true },
  });
  if (!(await prisma.motivoPausa.count({ where: { empresaId } }))) {
    await prisma.motivoPausa.createMany({ data: MOTIVOS_PADRAO.map((m) => ({ empresaId, ...m })), skipDuplicates: true });
  }
  return (await ler()).map((m) => ({ ...m, tipo: m.tipo as TipoMotivo }));
}

/** O motivo que vale: o do cadastro (mesmo inativado depois de o técnico escolher sem sinal); sem ele, o que o aparelho mandou */
async function motivoQueVale(empresaId: string, d: { motivoId: string | null; motivo: string; impedimento: boolean }) {
  const m = d.motivoId ? await prisma.motivoPausa.findFirst({ where: { id: d.motivoId, empresaId }, select: { id: true, nome: true, tipo: true, pedeTexto: true } }) : null;
  return m ? { motivoId: m.id, motivo: m.nome, impedimento: m.tipo === "IMPEDIMENTO", pedeTexto: m.pedeTexto } : { motivoId: null, motivo: d.motivo, impedimento: d.impedimento, pedeTexto: false };
}

export interface DadosPausar { clientId: string; motivoId: string | null; motivo: string; impedimento: boolean; observacao?: string | null }

/**
 * Pausa a atividade em andamento. Mesmo clientId de novo = a mesma pausa (nada se repete). Já pausada por outra
 * pausa: recusa (uma pausa aberta por vez). Impedimento: o escritório é avisado (sino e push).
 */
export async function pausarAtividade(ctx: ContextoExecucao, d: DadosPausar, relogio?: RelogioDaConclusao): Promise<Resultado> {
  const ja = await prisma.atividadePausa.findUnique({ where: { clientId: d.clientId }, select: { id: true, atividadeId: true } });
  if (ja) return ja.atividadeId === ctx.atividade.id ? ok({ pausaId: ja.id, repetida: true }) : erro(409, "Identificador de pausa já usado em outra atividade.");
  if (ctx.atividade.status !== "EM_ANDAMENTO") return erro(409, MSG_NAO_EM_ANDAMENTO);
  const aberta = await prisma.atividadePausa.findFirst({ where: { atividadeId: ctx.atividade.id, fim: null }, select: { id: true } });
  if (aberta) return erro(409, MSG_JA_PAUSADA);
  const m = await motivoQueVale(ctx.empresaId, d);
  const observacao = d.observacao?.trim() || null;
  if (m.pedeTexto && (observacao ?? "").length < 3) return erro(422, MSG_TEXTO_OBRIGATORIO);
  const inicio = momentoDaConclusao(relogio);
  let pausa: { id: string };
  try {
    pausa = await prisma.atividadePausa.create({
      data: { empresaId: ctx.empresaId, atividadeId: ctx.atividade.id, motivoId: m.motivoId, motivo: m.motivo, impedimento: m.impedimento, observacao, inicio, pausadoPorId: ctx.usuarioId, clientId: d.clientId },
      select: { id: true },
    });
  } catch (e) {
    if (!ehDuplicado(e)) throw e;
    const r = await prisma.atividadePausa.findUnique({ where: { clientId: d.clientId }, select: { id: true } });
    return ok({ pausaId: r?.id, repetida: true });
  }
  await prisma.osHistorico.create({
    data: { ordemServicoId: ctx.atividade.ordemServico.id, usuarioId: ctx.usuarioId, acao: m.impedimento ? "Atividade pausada (impedimento)" : "Atividade pausada",
      detalhes: `"${ctx.atividade.titulo}": ${m.motivo}${observacao ? ` — ${observacao}` : ""}` },
  });
  if (m.impedimento) {
    const { notificarImpedimento } = await import("@/lib/push/eventos");
    notificarImpedimento(pausa.id);
  }
  return ok({ pausaId: pausa.id, impedimento: m.impedimento }, 201);
}

/** Retoma: fecha a pausa (a hora do toque). Já retomada = nada a fazer. */
export async function retomarAtividade(ctx: ContextoExecucao, d: { pausaClientId: string }, relogio?: RelogioDaConclusao): Promise<Resultado> {
  const p = await prisma.atividadePausa.findFirst({ where: { clientId: d.pausaClientId, atividadeId: ctx.atividade.id }, select: { id: true, fim: true, inicio: true, motivo: true } });
  if (!p) return erro(404, MSG_NAO_PAUSADA);
  if (p.fim) return ok({ pausaId: p.id, jaEstava: true });
  const fim = new Date(Math.max(momentoDaConclusao(relogio).getTime(), p.inicio.getTime()));
  const { count } = await prisma.atividadePausa.updateMany({ where: { id: p.id, fim: null }, data: { fim, retomadoPorId: ctx.usuarioId } });
  if (count) {
    await prisma.osHistorico.create({ data: { ordemServicoId: ctx.atividade.ordemServico.id, usuarioId: ctx.usuarioId, acao: "Atividade retomada", detalhes: `"${ctx.atividade.titulo}": depois de “${p.motivo}”` } });
  }
  return ok({ pausaId: p.id });
}

/**
 * Encerra a visita como "Não concluída — precisa voltar" (só com uma pausa ABERTA de impedimento): fecha a pausa,
 * os equipamentos não feitos ficam "não atendidos" com o motivo (o mesmo "não atendido" de sempre, no relatório), e a
 * atividade volta a AGENDADA sem data — a reagendar, com o motivo no histórico da OS.
 */
export async function naoConcluirAtividade(ctx: ContextoExecucao, d: { pausaClientId: string; observacao?: string | null }, relogio?: RelogioDaConclusao): Promise<Resultado> {
  const p = await prisma.atividadePausa.findFirst({ where: { clientId: d.pausaClientId, atividadeId: ctx.atividade.id }, select: { id: true, fim: true, inicio: true, motivo: true, impedimento: true, naoConcluida: true } });
  if (!p) return erro(404, MSG_NAO_PAUSADA);
  if (p.naoConcluida) return ok({ pausaId: p.id, jaEstava: true });
  if (p.fim || !p.impedimento) return erro(409, MSG_SO_IMPEDIMENTO);
  const fim = new Date(Math.max(momentoDaConclusao(relogio).getTime(), p.inicio.getTime()));
  const texto = textoNaoConcluida(p.motivo, d.observacao);
  const feito = await prisma.$transaction(async (tx) => {
    const { count } = await tx.atividadePausa.updateMany({ where: { id: p.id, fim: null }, data: { fim, naoConcluida: true, retomadoPorId: ctx.usuarioId, ...(d.observacao?.trim() ? { observacao: d.observacao.trim() } : {}) } });
    if (!count) return false;
    await tx.atividadeEquipamento.updateMany({ where: { atividadeId: ctx.atividade.id, feito: false, observacao: null }, data: { observacao: texto } });
    await tx.atividadeOs.updateMany({ where: { id: ctx.atividade.id, status: "EM_ANDAMENTO" }, data: { status: "AGENDADA", dataAgendada: null, iniciadaEm: null } });
    await tx.osHistorico.create({ data: { ordemServicoId: ctx.atividade.ordemServico.id, usuarioId: ctx.usuarioId, acao: "Visita não concluída — reagendar", detalhes: `"${ctx.atividade.titulo}": ${texto}` } });
    return true;
  });
  if (feito) {
    ctx.atividade.status = "AGENDADA";
    await sincronizarStatusOs(ctx.atividade.ordemServico.id, ctx.empresaId, ctx.usuarioId);
  }
  return ok({ pausaId: p.id, status: "AGENDADA" });
}

/** Concluir com uma pausa aberta: a pausa fecha na hora da conclusão (o tempo depois dela não é pausa) */
export async function fecharPausaAoConcluir(atividadeId: string, concluidaEm: Date, usuarioId: string) {
  await prisma.atividadePausa.updateMany({ where: { atividadeId, fim: null }, data: { fim: concluidaEm, retomadoPorId: usuarioId } });
}

/** As pausas abertas da empresa (escritório: OS, lista, Pendências) — da atividade em andamento */
export async function pausasAbertas(empresaId: string, o: { soImpedimento?: boolean; osIds?: string[] } = {}) {
  return prisma.atividadePausa.findMany({
    where: { empresaId, fim: null, ...(o.soImpedimento ? { impedimento: true } : {}), atividade: { status: "EM_ANDAMENTO", ...(o.osIds ? { ordemServicoId: { in: o.osIds } } : {}) } },
    orderBy: { inicio: "asc" },
    select: { id: true, motivo: true, impedimento: true, inicio: true, observacao: true, atividade: { select: { id: true, titulo: true, ordemServicoId: true, ordemServico: { select: { numero: true } }, tecnico: { select: { nome: true } } } } },
  });
}

/** A pausa aberta da atividade no formato do app (retrato) — null = em execução */
export async function pausaParaRetrato(atividadeId: string) {
  const p = await prisma.atividadePausa.findFirst({ where: { atividadeId, fim: null }, orderBy: { inicio: "desc" }, select: { clientId: true, motivo: true, impedimento: true, inicio: true, observacao: true } });
  return p ? { clientId: p.clientId, motivo: p.motivo, impedimento: p.impedimento, inicio: p.inicio.toISOString(), observacao: p.observacao } : null;
}
