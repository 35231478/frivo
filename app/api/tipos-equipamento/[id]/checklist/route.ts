import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { checklistSugerido } from "@/lib/checklist/padrao";
import { checklistSchema, planejarChecklist } from "@/lib/checklist/tipo";

type Params = { params: Promise<{ id: string }> };

/** O checklist do tipo (itens ativos, na ordem) + a sugestão para quando ainda está vazio. */
async function carregar(empresaId: string, id: string) {
  const tipo = await prisma.tipoEquipamentoCustom.findFirst({ where: { id, empresaId }, select: { id: true, nome: true, chaveEnum: true, ativo: true } });
  if (!tipo) return null;
  const itens = await prisma.checklistTipoItem.findMany({
    where: { tipoEquipamentoId: id, ativo: true },
    orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }],
    select: { id: true, texto: true, tipoResposta: true, pedirFoto: true, pedirObservacao: true, ordem: true, _count: { select: { respostas: true } } },
  });
  return {
    tipo,
    itens: itens.map(({ _count, ...i }) => ({ ...i, respostas: _count.respostas })),
    sugestao: checklistSugerido(tipo.chaveEnum).map((i) => ({ texto: i.texto, pedirFoto: !!i.pedirFoto, pedirObservacao: !!i.pedirObservacao })),
  };
}

export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("configuracoes", "visualizar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const dados = await carregar(guard.session.user!.empresaId, id);
  if (!dados) return NextResponse.json({ erro: "Tipo de equipamento não encontrado" }, { status: 404 });
  return NextResponse.json(dados);
}

/**
 * Grava o checklist inteiro (a lista na ordem da tela): atualiza os itens que mudaram, cria os novos
 * e INATIVA os que saíram — nada é apagado, as respostas antigas continuam no histórico.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const empresaId = guard.session.user!.empresaId;

  const tipo = await prisma.tipoEquipamentoCustom.findFirst({ where: { id, empresaId }, select: { id: true } });
  if (!tipo) return NextResponse.json({ erro: "Tipo de equipamento não encontrado" }, { status: 404 });

  const parsed = checklistSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });

  const atuais = await prisma.checklistTipoItem.findMany({
    where: { tipoEquipamentoId: id, ativo: true },
    select: { id: true, texto: true, pedirFoto: true, pedirObservacao: true, ordem: true },
  });
  const r = planejarChecklist(atuais, parsed.data.itens);
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 400 });

  const { plano } = r;
  await prisma.$transaction(async (tx) => {
    for (const { id: itemId, ...dados } of plano.atualizar) await tx.checklistTipoItem.update({ where: { id: itemId }, data: dados });
    if (plano.criar.length) await tx.checklistTipoItem.createMany({ data: plano.criar.map((c) => ({ ...c, empresaId, tipoEquipamentoId: id })) });
    if (plano.inativar.length) await tx.checklistTipoItem.updateMany({ where: { id: { in: plano.inativar }, tipoEquipamentoId: id }, data: { ativo: false } });
  });
  return NextResponse.json(await carregar(empresaId, id));
}
