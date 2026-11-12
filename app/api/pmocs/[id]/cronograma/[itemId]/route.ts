import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { itemCronogramaSchema } from "@/lib/pmoc-cronograma";
import { lerCronograma } from "@/lib/pmoc-cronograma-server";
import { atorDoCronograma, dadosDoItem, gerarAoSalvar, planoEditavel, validarItem } from "@/lib/pmoc-cronograma-rotas";

type Params = { params: Promise<{ id: string; itemId: string }> };

const itemDoPlano = (pmocId: string, itemId: string) => prisma.pmocCronograma.findFirst({ where: { id: itemId, pmocId, ativo: true }, select: { id: true, _count: { select: { execucoes: true } } } });
const NAO_ENCONTRADO = () => NextResponse.json({ erro: "Item do cronograma não encontrado" }, { status: 404 });

/** Edita um item. As OS que passarem a faltar são geradas; mudar datas das já geradas é o "Reagendar atividades". */
export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("pmoc", "editar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id, itemId } = await params;
  const { pmoc, erro } = await planoEditavel(id, empresaId);
  if (erro) return erro;
  if (!(await itemDoPlano(id, itemId))) return NAO_ENCONTRADO();

  const parsed = itemCronogramaSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const invalido = await validarItem(pmoc!, empresaId, parsed.data);
  if (invalido) return NextResponse.json({ erro: invalido }, { status: 400 });

  await prisma.pmocCronograma.update({ where: { id: itemId }, data: dadosDoItem(parsed.data) });
  const gerado = await gerarAoSalvar(id, atorDoCronograma(guard.session));
  return NextResponse.json({ cronograma: await lerCronograma(id, empresaId), gerado });
}

/**
 * Exclui um item do cronograma. Item que já gerou OS não é apagado: fica inativo (o vínculo das OS
 * com o plano continua). As OS futuras dele só saem da agenda no "Reagendar atividades".
 */
export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("pmoc", "editar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id, itemId } = await params;
  const { erro } = await planoEditavel(id, empresaId);
  if (erro) return erro;
  const item = await itemDoPlano(id, itemId);
  if (!item) return NAO_ENCONTRADO();
  if (item._count.execucoes) await prisma.pmocCronograma.update({ where: { id: itemId }, data: { ativo: false } });
  else await prisma.pmocCronograma.delete({ where: { id: itemId } });
  return NextResponse.json({ cronograma: await lerCronograma(id, empresaId) });
}
