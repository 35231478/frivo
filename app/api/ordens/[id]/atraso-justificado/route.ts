import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { bloqueioPainelTecnico } from "@/lib/tecnico/painel";
import { prisma } from "@/lib/prisma";
import type { Permissoes } from "@/lib/permissoes";
import {
  MSG_ATRASO_NAO_ATRASADA, MSG_SEM_PERMISSAO_JUSTIFICAR, atrasoJustificado, atrasoJustificadoSchema, haAtrasoParaJustificar,
  podeJustificarAtraso, rotuloMotivoAtraso,
} from "@/lib/os/prazo-execucao";

/**
 * ATRASO JUSTIFICADO da OS: o gestor diz por que atrasou (cliente ausente, peça faltando, acesso
 * negado, clima, outro). A OS continua atrasada — o que muda é que o atraso deixa de pesar no
 * desempenho de quem executou.
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
      atividades: { select: { status: true, prazo: true, dataAgendada: true, concluidaEm: true } },
    },
  });
  if (!os) return { resposta: NextResponse.json({ erro: "Não encontrado" }, { status: 404 }) };
  return { os, usuarioId: session.user!.id as string };
}

const SELECT_RESPOSTA = {
  atrasoJustificadoMotivo: true, atrasoJustificadoObs: true, atrasoJustificadoEm: true, atrasoJustificadoPor: { select: { id: true, nome: true } },
} as const;

/** Justifica (ou corrige a justificativa de) o atraso desta OS. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const e = await entrar(id);
  if (e.resposta) return e.resposta;

  const parsed = atrasoJustificadoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  // Sem atraso (da OS ou de alguma atividade) não há o que justificar
  if (!haAtrasoParaJustificar(e.os)) return NextResponse.json({ erro: MSG_ATRASO_NAO_ATRASADA }, { status: 409 });

  const { motivo, observacao } = parsed.data;
  const [atualizada] = await prisma.$transaction([
    prisma.ordemServico.update({
      where: { id },
      data: { atrasoJustificadoMotivo: motivo, atrasoJustificadoObs: observacao || null, atrasoJustificadoPorId: e.usuarioId, atrasoJustificadoEm: new Date() },
      select: SELECT_RESPOSTA,
    }),
    prisma.osHistorico.create({
      data: {
        ordemServicoId: id, usuarioId: e.usuarioId,
        acao: atrasoJustificado(e.os) ? "Justificativa do atraso alterada" : "Atraso justificado",
        detalhes: [rotuloMotivoAtraso(motivo), observacao].filter(Boolean).join(": "),
      },
    }),
  ]);
  return NextResponse.json(atualizada);
}

/** Desfaz a justificativa: o atraso volta a contar. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const e = await entrar(id);
  if (e.resposta) return e.resposta;
  if (!atrasoJustificado(e.os)) return NextResponse.json({ erro: "Esta OS não tem atraso justificado." }, { status: 409 });

  const [atualizada] = await prisma.$transaction([
    prisma.ordemServico.update({
      where: { id },
      data: { atrasoJustificadoMotivo: null, atrasoJustificadoObs: null, atrasoJustificadoPorId: null, atrasoJustificadoEm: null },
      select: SELECT_RESPOSTA,
    }),
    prisma.osHistorico.create({
      data: { ordemServicoId: id, usuarioId: e.usuarioId, acao: "Justificativa do atraso desfeita", detalhes: `Era: ${rotuloMotivoAtraso(e.os.atrasoJustificadoMotivo)}.` },
    }),
  ]);
  return NextResponse.json(atualizada);
}
