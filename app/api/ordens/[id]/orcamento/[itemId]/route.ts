import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { osDaEmpresa } from "@/lib/os-server";
import { respostaRefEmpresa } from "@/lib/ref-empresa";
import { itemOsSchema, linhaOsContextoSchema } from "@/lib/validations";
import { atualizarValoresDoItemOs, INCLUIR_ITEM_OS, prepararItemOsConferido, regravarItemOs } from "@/lib/os/materiais-server";
import { prepararItemOs, unitarioParaEdicao } from "@/lib/os/materiais";
import { motivoDaLinhaDaOs } from "@/lib/edicao-contexto";
import { situacaoDaOsNoBanco, travaDasLinhasDaOs } from "@/lib/os/trava-edicao-server";
import { formatarMoeda } from "@/lib/utils";
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
  // Registro fechado (OS assinada pelo cliente, faturada ou com nota): as linhas não mudam mais
  const fechada = await travaDasLinhasDaOs(id);
  if (fechada) return NextResponse.json({ erro: fechada }, { status: 400 });
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

/**
 * PATCH: edição da linha como USO ("Editando este item da OS") — descrição, quantidade e o preço aplicado
 * NESTA OS, e só o que mudou. Nunca toca no catálogo: o serviço/produto de origem não é lido nem gravado, e
 * o retrato dos materiais copiado para a linha fica como está. Registro fechado (OS assinada pelo cliente,
 * faturada ou com nota), item do orçamento aprovado, peça derivada e item executado não se editam.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id, itemId } = await params;
  if (!(await osDaEmpresa(id, session.user!.empresaId))) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });

  const item = await prisma.osItemOrcamento.findFirst({ where: { id: itemId, ordemServicoId: id }, include: { materiais: { orderBy: { ordem: "asc" } } } });
  if (!item) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  const motivo = motivoDaLinhaDaOs(item, await situacaoDaOsNoBanco(id));
  if (motivo) return NextResponse.json({ erro: motivo }, { status: 400 });

  const parsed = linhaOsContextoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const m = parsed.data;
  if (m.descricao === undefined && m.quantidade === undefined && m.valorUnitario === undefined) return NextResponse.json({ erro: "Nada para alterar." }, { status: 400 });
  // Linha com total digitado à mão: o preço dela é esse total (muda pelos materiais do serviço, não pelo unitário)
  if (item.valorManual && m.valorUnitario !== undefined)
    return NextResponse.json({ erro: "Linha com valor manual: ajuste o valor em Materiais e peças." }, { status: 400 });

  // O retrato copiado volta como está: nada é relido do catálogo
  const materiais = item.materiais.map((x) => ({
    produtoId: x.produtoId, descricao: x.descricao, unidade: x.unidade, comportamento: x.comportamento, quantidade: Number(x.quantidade),
    quantidadePadrao: Number(x.quantidadePadrao), valorVendaUnit: Number(x.valorVendaUnit), custoUnit: x.custoUnit == null ? null : Number(x.custoUnit), origem: x.origem, kitNome: x.kitNome,
  }));
  const p = prepararItemOs({
    tipo: item.tipo, servicoId: item.servicoId, produtoId: item.produtoId,
    descricao: m.descricao ?? item.descricao, quantidade: m.quantidade ?? Number(item.quantidade),
    valorUnitario: m.valorUnitario ?? unitarioParaEdicao(item),
    ...(materiais.length ? { valorManual: item.valorManual, valorTotal: item.valorManual ? Number(item.valorTotal) : undefined, materiais } : {}),
  });
  const mudou = [
    p.descricao !== item.descricao && `descrição: ${item.descricao} → ${p.descricao}`,
    p.quantidade !== Number(item.quantidade) && `quantidade: ${Number(item.quantidade)} → ${p.quantidade}`,
    p.valorTotal !== Number(item.valorTotal) && `total: ${formatarMoeda(Number(item.valorTotal))} → ${formatarMoeda(p.valorTotal)}`,
  ].filter(Boolean);
  await prisma.$transaction(async (tx) => {
    await atualizarValoresDoItemOs(tx, itemId, p);
    if (mudou.length) await tx.osHistorico.create({ data: { ordemServicoId: id, usuarioId: session.user!.id, acao: "Item da OS editado", detalhes: `${item.descricao} — ${mudou.join("; ")}`.slice(0, 500) } });
  });
  const atualizado = await prisma.osItemOrcamento.findUnique({ where: { id: itemId }, include: INCLUIR_ITEM_OS });
  return NextResponse.json(atualizado);
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
  // Registro fechado: as linhas não saem mais
  const fechada = await travaDasLinhasDaOs(id);
  if (fechada) return NextResponse.json({ erro: fechada }, { status: 400 });
  // Peça derivada não se apaga sozinha: ela segue o material do serviço (tire o material, ou zere a quantidade)
  if (item.materialId) return NextResponse.json({ erro: "Peça derivada: tire o material nos materiais do serviço." }, { status: 400 });
  // E4.1: material separado (reservado no razão) não some junto com o item — desfaz a separação antes
  if (await itemTemMaterialSeparado(itemId)) return NextResponse.json({ erro: ERRO_ITEM_SEPARADO }, { status: 400 });
  // Materiais e peças derivadas do item caem em cascata
  await prisma.osItemOrcamento.delete({ where: { id: itemId } });
  return NextResponse.json({ ok: true });
}
