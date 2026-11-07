import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { osDaEmpresa } from "@/lib/os-server";
import { respostaRefEmpresa } from "@/lib/ref-empresa";
import { itemOsSchema } from "@/lib/validations";
import { INCLUIR_ITEM_OS, prepararItemOsConferido, regravarItemOs } from "@/lib/os/materiais-server";
import { ERRO_ITEM_SEPARADO, itemTemMaterialSeparado } from "@/lib/estoque/separacao-server";

type Params = { params: Promise<{ id: string; itemId: string }> };

/**
 * PUT: { executado: true } marca executado (como sempre); senão, edita o item da OS sem orçamento (E3.3b):
 * quantidade, unitário base, total manual e o snapshot dos materiais — regrava materiais e peças derivadas.
 * Item que veio do orçamento (orcamentoServicoId) e peça derivada (materialId) não se editam aqui.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { id, itemId } = await params;
  if (!(await osDaEmpresa(id, empresaId))) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
  const body = await req.json();

  const item = await prisma.osItemOrcamento.findFirst({ where: { id: itemId, ordemServicoId: id } });
  if (!item) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  if (body.executado === true && !item.executado) {
    const atualizado = await prisma.osItemOrcamento.update({
      where: { id: itemId },
      data: { executado: true, executadoEm: new Date() },
    });

    // O item executado é faturado direto pelo "Gerar medição" da OS (fluxo único);
    // o espelho antigo (OsItemFinanceiro) saiu junto com a medição interna.
    await prisma.osHistorico.create({
      data: { ordemServicoId: id, usuarioId: session.user!.id, acao: "Item executado", detalhes: item.descricao },
    });

    return NextResponse.json(atualizado);
  }
  if (body.executado !== undefined) return NextResponse.json(item);

  // Edição (E3.3b)
  if (item.orcamentoServicoId) return NextResponse.json({ erro: "Este item veio do orçamento aprovado: edite-o no orçamento." }, { status: 400 });
  if (item.materialId) return NextResponse.json({ erro: "Peça derivada: edite-a nos materiais do serviço." }, { status: 400 });
  if (item.executado) return NextResponse.json({ erro: "Item já executado não pode ser alterado." }, { status: 400 });
  // E4.1: regravar o item apaga e recria o snapshot — com material já separado (reservado) a reserva ficaria órfã
  if (await itemTemMaterialSeparado(itemId)) return NextResponse.json({ erro: ERRO_ITEM_SEPARADO }, { status: 400 });
  const parsed = itemOsSchema.safeParse({ tipo: item.tipo, servicoId: item.servicoId, produtoId: item.produtoId, descricao: item.descricao, quantidade: Number(item.quantidade), valorUnitario: Number(item.valorUnitario), ...body });
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  if (parsed.data.tipo !== item.tipo || (parsed.data.servicoId ?? null) !== item.servicoId || (parsed.data.produtoId ?? null) !== item.produtoId)
    return NextResponse.json({ erro: "O tipo e o vínculo com o catálogo não mudam: remova o item e adicione outro." }, { status: 400 });
  let prep;
  try { prep = await prepararItemOsConferido(empresaId, parsed.data); } catch (e) { const r = respostaRefEmpresa(e); if (r) return r; throw e; }
  await prisma.$transaction((tx) => regravarItemOs(tx, id, itemId, prep));
  const atualizado = await prisma.osItemOrcamento.findUnique({ where: { id: itemId }, include: INCLUIR_ITEM_OS });
  const pecas = await prisma.osItemOrcamento.findMany({ where: { ordemServicoId: id, material: { osItemId: itemId } }, orderBy: { ordem: "asc" }, include: INCLUIR_ITEM_OS });
  return NextResponse.json({ ...atualizado, pecas });
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id, itemId } = await params;
  if (!(await osDaEmpresa(id, session.user!.empresaId))) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });

  // Só apaga item desta OS (antes apagava qualquer item pelo id, de qualquer OS/empresa)
  const item = await prisma.osItemOrcamento.findFirst({ where: { id: itemId, ordemServicoId: id }, select: { id: true, materialId: true } });
  if (!item) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  // Peça derivada não se apaga sozinha: ela segue o material do serviço (tire o material, ou zere a quantidade)
  if (item.materialId) return NextResponse.json({ erro: "Peça derivada: tire o material nos materiais do serviço." }, { status: 400 });
  // E4.1: material separado (reservado no razão) não some junto com o item — desfaz a separação antes
  if (await itemTemMaterialSeparado(itemId)) return NextResponse.json({ erro: ERRO_ITEM_SEPARADO }, { status: 400 });
  // Materiais e peças derivadas do item caem em cascata
  await prisma.osItemOrcamento.delete({ where: { id: itemId } });
  return NextResponse.json({ ok: true });
}
