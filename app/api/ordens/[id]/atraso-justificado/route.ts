import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { bloqueioPainelTecnico } from "@/lib/tecnico/painel";
import { prisma } from "@/lib/prisma";
import type { Permissoes } from "@/lib/permissoes";
import {
  MSG_ATRASO_NAO_ATRASADA, MSG_SEM_PERMISSAO_JUSTIFICAR, atrasoJustificado, atrasoJustificadoSchema,
  podeJustificarAtraso, rotuloMotivoAtraso, rotuloResponsabilidadeAtraso,
} from "@/lib/os/prazo-execucao";
import { haDescumprimentoParaJustificar } from "@/lib/prazos/cumprimento";
import { escopoBarra } from "@/lib/escopo/proprios-server";

/**
 * ATRASO JUSTIFICADO da OS: o gestor diz por que atrasou (cliente ausente, peça faltando, acesso
 * negado, clima, outro) e DE QUEM foi a causa (cliente, interna, força maior/terceiros). A OS
 * continua atrasada — o que muda é que o atraso deixa de pesar no desempenho de quem executou, e
 * que a causa do CLIENTE pausa o SLA no relatório que vai ao cliente.
 *
 * Há o que justificar sempre que algum dos três prazos do relatório está descumprido (comparecer,
 * resolver ou execução) ou há atividade atrasada — a mesma régua do relatório, nunca outra.
 *
 * Quem pode: quem vê a OS E tem "Desempenho › Revisar" (lib/os/prazo-execucao.ts › podeJustificarAtraso).
 * O técnico não: no app ele deixa a observação na execução, e quem justifica é o gestor.
 */
async function entrar(id: string) {
  const guard = await exigirPermissao("ordens", "visualizar");
  if (guard.erro) return { resposta: guard.resposta };
  const { session } = guard;
  const bloqueio = bloqueioPainelTecnico(session);
  if (bloqueio) return { resposta: bloqueio };
  if (!podeJustificarAtraso(session.user!.permissoes as Permissoes, session.user!.role))
    return { resposta: NextResponse.json({ erro: MSG_SEM_PERMISSAO_JUSTIFICAR }, { status: 403 }) };
  const os = await prisma.ordemServico.findFirst({
    where: { id, empresaId: session.user!.empresaId },
    select: {
      id: true, status: true, prazoExecucao: true, previsaoConclusao: true, dataConclusao: true, atrasoJustificadoMotivo: true,
      // os limites do contrato: o gatilho olha os TRÊS prazos (a rota só LÊ, quem grava é lib/atendimento)
      chamadoAbertoEm: true, atendimentoComparecerAte: true, atendimentoResolverAte: true, atendimentoComparecidoEm: true,
      atividades: { select: { status: true, prazo: true, dataAgendada: true, concluidaEm: true } },
    },
  });
  if (!os) return { resposta: NextResponse.json({ erro: "Não encontrado" }, { status: 404 }) };
  return { os, usuarioId: session.user!.id as string };
}

const SELECT_RESPOSTA = {
  atrasoJustificadoMotivo: true, atrasoJustificadoObs: true, atrasoJustificadoEm: true, atrasoResponsavel: true,
  atrasoJustificadoPor: { select: { id: true, nome: true } },
} as const;

/** Justifica (ou corrige a justificativa de) o atraso desta OS. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const foraDoEscopo = await escopoBarra("ordem", id); // COM-1: "Ver só os próprios" → 404
  if (foraDoEscopo) return foraDoEscopo;
  const e = await entrar(id);
  if (e.resposta) return e.resposta;

  const parsed = atrasoJustificadoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  // Nenhum prazo descumprido (nem atividade atrasada): não há o que justificar
  if (!haDescumprimentoParaJustificar(e.os)) return NextResponse.json({ erro: MSG_ATRASO_NAO_ATRASADA }, { status: 409 });

  const { motivo, responsavel, observacao } = parsed.data;
  const [atualizada] = await prisma.$transaction([
    prisma.ordemServico.update({
      where: { id },
      data: {
        atrasoJustificadoMotivo: motivo, atrasoJustificadoObs: observacao || null, atrasoResponsavel: responsavel,
        atrasoJustificadoPorId: e.usuarioId, atrasoJustificadoEm: new Date(),
      },
      select: SELECT_RESPOSTA,
    }),
    prisma.osHistorico.create({
      data: {
        ordemServicoId: id, usuarioId: e.usuarioId,
        acao: atrasoJustificado(e.os) ? "Justificativa do atraso alterada" : "Atraso justificado",
        detalhes: [`${rotuloMotivoAtraso(motivo)} (${rotuloResponsabilidadeAtraso(responsavel)})`, observacao].filter(Boolean).join(": "),
      },
    }),
  ]);
  return NextResponse.json(atualizada);
}

/** Desfaz a justificativa: o atraso volta a contar. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const foraDoEscopo = await escopoBarra("ordem", id); // COM-1: "Ver só os próprios" → 404
  if (foraDoEscopo) return foraDoEscopo;
  const e = await entrar(id);
  if (e.resposta) return e.resposta;
  if (!atrasoJustificado(e.os)) return NextResponse.json({ erro: "Esta OS não tem atraso justificado." }, { status: 409 });

  const [atualizada] = await prisma.$transaction([
    prisma.ordemServico.update({
      where: { id },
      data: {
        atrasoJustificadoMotivo: null, atrasoJustificadoObs: null, atrasoResponsavel: null,
        atrasoJustificadoPorId: null, atrasoJustificadoEm: null,
      },
      select: SELECT_RESPOSTA,
    }),
    prisma.osHistorico.create({
      data: { ordemServicoId: id, usuarioId: e.usuarioId, acao: "Justificativa do atraso desfeita", detalhes: `Era: ${rotuloMotivoAtraso(e.os.atrasoJustificadoMotivo)}.` },
    }),
  ]);
  return NextResponse.json(atualizada);
}
