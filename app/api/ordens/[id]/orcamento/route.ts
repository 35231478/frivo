import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { osDaEmpresa } from "@/lib/os-server";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

const itemSchema = z.object({
  descricao: z.string().min(1),
  quantidade: z.number().positive(),
  valorUnitario: z.number().positive(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  if (!(await osDaEmpresa(id, session.user!.empresaId))) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
  const body = await req.json();
  const parsed = itemSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  const valorTotal = parsed.data.quantidade * parsed.data.valorUnitario;
  const item = await prisma.osItemOrcamento.create({
    data: { ordemServicoId: id, ...parsed.data, valorTotal },
  });

  await prisma.osHistorico.create({
    data: { ordemServicoId: id, usuarioId: session.user!.id, acao: "Item de orçamento adicionado", detalhes: parsed.data.descricao },
  });

  return NextResponse.json(item, { status: 201 });
}
