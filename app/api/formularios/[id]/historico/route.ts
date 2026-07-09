import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

/**
 * Histórico de respostas deste formulário, agrupado por sessão (atividade + equipamento):
 * qual OS respondeu, qual equipamento, data e técnico. Ordenado do mais recente.
 */
export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const form = await prisma.formularioTemplate.findFirst({ where: { id, empresaId }, select: { id: true } });
  if (!form) return NextResponse.json({ erro: "Formulário não encontrado" }, { status: 404 });

  const respostas = await prisma.respostaFormularioEquipamento.findMany({
    where: { empresaId, formularioId: id },
    select: {
      atividadeId: true,
      equipamentoId: true,
      respondidoEm: true,
      equipamento: { select: { nome: true } },
      respondidoPor: { select: { nome: true } },
      atividade: { select: { ordemServico: { select: { id: true, numero: true } } } },
    },
    orderBy: { respondidoEm: "desc" },
    take: 2000,
  });

  // Agrupa por sessão (atividade + equipamento); mantém a resposta mais recente de cada.
  const sessoes = new Map<string, {
    ordemId: string; ordemNumero: string; equipamentoNome: string;
    tecnicoNome: string | null; respondidoEm: Date;
  }>();
  for (const r of respostas) {
    const k = `${r.atividadeId}|${r.equipamentoId}`;
    if (sessoes.has(k)) continue; // já é a mais recente (lista ordenada desc)
    sessoes.set(k, {
      ordemId: r.atividade.ordemServico.id,
      ordemNumero: r.atividade.ordemServico.numero,
      equipamentoNome: r.equipamento.nome ?? "—",
      tecnicoNome: r.respondidoPor?.nome ?? null,
      respondidoEm: r.respondidoEm,
    });
  }

  const lista = [...sessoes.values()]
    .sort((a, b) => b.respondidoEm.getTime() - a.respondidoEm.getTime())
    .slice(0, 200);

  return NextResponse.json(lista);
}
