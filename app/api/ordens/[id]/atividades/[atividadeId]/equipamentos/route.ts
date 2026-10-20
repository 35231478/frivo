import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { atorDaSessao, contextoExecucao } from "@/lib/execucao/contexto";
import { vincularEquipamentos } from "@/lib/execucao/acoes";
import { filtroEscopo } from "@/lib/tecnico/escopo";

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

async function getAtividade(empresaId: string, id: string, atividadeId: string, escopo: Parameters<typeof filtroEscopo>[0]) {
  return prisma.atividadeOs.findFirst({
    where: { id: atividadeId, ordemServicoId: id, empresaId, ...filtroEscopo(escopo) },
    select: { id: true },
  });
}

export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "visualizar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id, atividadeId } = await params;
  const empresaId = session.user!.empresaId;

  if (!(await getAtividade(empresaId, id, atividadeId, atorDaSessao(session).escopo))) {
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

  const r = await vincularEquipamentos(ctx, parsed.data.equipamentoIds);
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });

  const itens = await prisma.atividadeEquipamento.findMany({
    where: { atividadeId },
    select: equipSelect,
    orderBy: { criadoEm: "asc" },
  });
  return NextResponse.json(itens, { status: 201 });
}
