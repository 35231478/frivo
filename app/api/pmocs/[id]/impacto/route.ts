import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { situacaoPmoc, dataBR } from "@/lib/pmoc";

/** Pré-checagem do modal de inativar (mesmo padrão de #13). Exige "excluir". */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("pmoc", "excluir");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const p = await prisma.pmoc.findFirst({
    where: { id, empresaId: guard.session.user!.empresaId },
    select: { status: true, dataInicio: true, dataExpiracao: true, cliente: { select: { nome: true, nomeFantasia: true } }, _count: { select: { equipamentos: true } } },
  });
  if (!p) return NextResponse.json({ erro: "PMOC não encontrado" }, { status: 404 });
  const avisos: string[] = [];
  if (situacaoPmoc(p).status === "VIGENTE")
    avisos.push(`Este PMOC está VIGENTE até ${dataBR(p.dataExpiracao)}. Inativado, ${p.cliente.nomeFantasia ?? p.cliente.nome} fica sem PMOC ativo neste local — a lei exige um plano em vigor.`);
  if (p._count.equipamentos) avisos.push(`Os ${p._count.equipamentos} equipamento(s) vinculados continuam no cadastro e no PMOC (nada é apagado).`);
  return NextResponse.json({ bloqueio: null, avisos });
}
