import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { equipamentoSchema } from "@/lib/validations";
import { resolverTipoEquipamentoId } from "@/lib/tipo-equipamento";

/**
 * Lista equipamentos ativos. Além de quem visualiza o módulo, libera a leitura para
 * quem usa os seletores de equipamento na OS (ordens) e no orçamento (orcamentos).
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { permissoes, role } = session.user!;
  if (!["equipamentos", "ordens", "orcamentos"].some((m) => pode(permissoes, m, "visualizar", role)))
    return NextResponse.json({ erro: "Sem permissão para esta ação" }, { status: 403 });

  const empresaId = session.user!.empresaId;
  const { searchParams } = new URL(req.url);
  const unidadeId = searchParams.get("unidadeId");
  const clienteId = searchParams.get("clienteId");

  const equipamentos = await prisma.equipamento.findMany({
    where: {
      empresaId,
      ativo: true,
      ...(unidadeId && { unidadeId }),
      ...(clienteId && { unidade: { clienteId } }),
    },
    include: {
      unidade: {
        select: {
          id: true,
          nome: true,
          cidade: true,
          cliente: { select: { id: true, nome: true, nomeFantasia: true } },
        },
      },
    },
    orderBy: { criadoEm: "desc" },
  });

  return NextResponse.json(equipamentos);
}

export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("equipamentos", "criar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;

  const empresaId = session.user!.empresaId;
  const body = await req.json();
  const parsed = equipamentoSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  // Garante que a unidade pertence à empresa
  const unidade = await prisma.unidade.findFirst({
    where: { id: parsed.data.unidadeId, empresaId },
  });
  if (!unidade) return NextResponse.json({ erro: "Unidade não encontrada" }, { status: 404 });

  const { dataInstalacao, dataFabricacao, garantiaAte, ...resto } = parsed.data;
  const tipoEquipamentoId = await resolverTipoEquipamentoId(empresaId, resto.tipo);
  const equipamento = await prisma.equipamento.create({
    data: {
      ...resto,
      empresaId,
      tipoEquipamentoId,
      dataInstalacao: dataInstalacao ? new Date(dataInstalacao) : null,
      dataFabricacao: dataFabricacao ? new Date(dataFabricacao) : null,
      garantiaAte: garantiaAte ? new Date(garantiaAte) : null,
    },
  });

  return NextResponse.json(equipamento, { status: 201 });
}
