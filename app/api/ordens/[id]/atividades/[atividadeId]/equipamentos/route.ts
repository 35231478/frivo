import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { contextoExecucao } from "@/lib/execucao/contexto";
import { equipamentosDoCliente } from "@/lib/execucao/vinculos";

type Params = { params: Promise<{ id: string; atividadeId: string }> };

const equipSelect = {
  id: true,
  feito: true,
  feitoEm: true,
  equipamento: {
    select: {
      id: true, nome: true, marca: true, modelo: true, numeroSerie: true,
      localizacao: true, tipo: true, tipoEquipamentoId: true,
      tipoEquipamento: { select: { id: true, nome: true } },
    },
  },
} as const;

async function getAtividade(empresaId: string, id: string, atividadeId: string) {
  return prisma.atividadeOs.findFirst({
    where: { id: atividadeId, ordemServicoId: id, empresaId },
    select: { id: true },
  });
}

export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "visualizar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id, atividadeId } = await params;
  const empresaId = session.user!.empresaId;

  if (!(await getAtividade(empresaId, id, atividadeId))) {
    return NextResponse.json({ erro: "Atividade não encontrada" }, { status: 404 });
  }

  const itens = await prisma.atividadeEquipamento.findMany({
    where: { atividadeId },
    select: equipSelect,
    orderBy: { criadoEm: "asc" },
  });
  return NextResponse.json(itens);
}

const postSchema = z.object({ equipamentoIds: z.array(z.string().min(1)).min(1).max(200) });

/**
 * Vincula equipamentos (escolhidos na lista da unidade) à atividade — na montagem da OS ou durante a
 * execução (por isso também com "concluir", como o técnico em campo). Só do cliente da OS e ativos.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id, atividadeId } = await params;
  const ctx = await contextoExecucao(id, atividadeId);
  if (!ctx.ok) return ctx.resposta;

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  const { validos, erro } = await equipamentosDoCliente(ctx.empresaId, ctx.atividade.ordemServico.clienteId, parsed.data.equipamentoIds);
  if (erro) return NextResponse.json({ erro }, { status: 400 });

  await prisma.atividadeEquipamento.createMany({
    data: validos.map((equipamentoId) => ({ atividadeId, equipamentoId })),
    skipDuplicates: true,
  });

  const itens = await prisma.atividadeEquipamento.findMany({
    where: { atividadeId },
    select: equipSelect,
    orderBy: { criadoEm: "asc" },
  });
  return NextResponse.json(itens, { status: 201 });
}
