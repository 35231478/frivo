import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";

/**
 * Cria uma cópia do PMOC como RASCUNHO: mesmos dados gerais, RT e equipamentos.
 * Não copia a ART (número e arquivo são de cada plano) — precisa de uma nova.
 */
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("pmoc", "criar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { id } = await params;
  const o = await prisma.pmoc.findFirst({
    where: { id, empresaId },
    select: {
      nome: true, descricao: true, clienteId: true, unidadeId: true, dataInicio: true, dataExpiracao: true,
      responsavelTecnicoId: true, rtNome: true, rtCrea: true,
      equipamentos: { select: { equipamentoId: true } },
    },
  });
  if (!o) return NextResponse.json({ erro: "PMOC não encontrado" }, { status: 404 });
  const copia = await prisma.pmoc.create({
    data: {
      empresaId, criadoPorId: session.user!.id, status: "RASCUNHO",
      nome: `Cópia de ${o.nome}`.slice(0, 150), descricao: o.descricao, clienteId: o.clienteId, unidadeId: o.unidadeId,
      dataInicio: o.dataInicio, dataExpiracao: o.dataExpiracao,
      responsavelTecnicoId: o.responsavelTecnicoId, rtNome: o.rtNome, rtCrea: o.rtCrea,
      equipamentos: { create: o.equipamentos.map((e) => ({ equipamentoId: e.equipamentoId })) },
    },
    select: { id: true },
  });
  return NextResponse.json(copia, { status: 201 });
}
