import { NextRequest, NextResponse } from "next/server";
import { erroDeValidacao } from "@/lib/forms/erros-server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { respostaRefEmpresa, validarRefEmpresa } from "@/lib/ref-empresa";
import { ERRO_CHECKLIST_INATIVO, itemGeraAlerta, primeiroObrigatorioFaltando, statusPelosAlertas, type RespostaDoItem } from "@/lib/veiculos/checklist";

type Params = { params: Promise<{ id: string }> };

/** O checklist da empresa, com tudo que o detalhe mostra (respostas, fotos, quem editou e quem inativou) */
async function carregar(id: string, empresaId: string) {
  return prisma.checklistPreenchido.findFirst({
    where: { id, empresaId },
    include: {
      veiculo: { select: { id: true, placa: true, modelo: true } },
      template: { select: { id: true, nome: true } },
      colaborador: { select: { id: true, nome: true } },
      editadoPor: { select: { nome: true } },
      inativadoPor: { select: { nome: true } },
      itens: { include: { itemTemplate: { select: { id: true, categoria: true, descricao: true, tipo: true, opcoes: true, obrigatorio: true, ordem: true } } } },
    },
  });
}

/** Detalhe do checklist preenchido. Ver: Veículos › visualizar. */
export async function GET(_req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("veiculos", "visualizar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const c = await carregar(id, guard.session.user!.empresaId);
  if (!c) return NextResponse.json({ erro: "Checklist não encontrado" }, { status: 404 });
  return NextResponse.json(c);
}

const editarSchema = z.object({
  colaboradorId: z.string().nullable().optional(),
  observacaoGeral: z.string().max(5000).nullable().optional(),
  itens: z.array(z.object({
    itemTemplateId: z.string().min(1),
    valor: z.string().max(5000).nullable().optional(),
    // Foto: ausente = fica a que está; null = tira; texto = troca
    foto: z.string().nullable().optional(),
  })).default([]),
});

/**
 * Corrigir o checklist preenchido (as respostas, a observação e o colaborador). Editar: Veículos ›
 * gerenciar. Só itens que o checklist já tem; o alerta e a situação são recalculados aqui (a tela não
 * decide). Checklist inativado não se edita. Fica registrado quem editou e quando.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("veiculos", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { id } = await params;

  const atual = await carregar(id, empresaId);
  if (!atual) return NextResponse.json({ erro: "Checklist não encontrado" }, { status: 404 });
  if (atual.inativadoEm) return NextResponse.json({ erro: ERRO_CHECKLIST_INATIVO }, { status: 409 });

  const parsed = editarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return erroDeValidacao(parsed.error);
  const d = parsed.data;

  if (d.colaboradorId) {
    try { await validarRefEmpresa("tecnico", d.colaboradorId, empresaId, "Colaborador"); }
    catch (e) { const r = respostaRefEmpresa(e); if (r) return r; throw e; }
  }

  const porItem = new Map(atual.itens.map((i) => [i.itemTemplateId, i]));
  if (d.itens.some((i) => !porItem.has(i.itemTemplateId))) return NextResponse.json({ erro: "Item de checklist inválido." }, { status: 400 });

  // As respostas como ficam depois da edição (o que não veio continua como está)
  const depois = new Map<string, RespostaDoItem>(atual.itens.map((i) => [i.itemTemplateId, { valor: i.valor, foto: i.foto }]));
  for (const i of d.itens) {
    const antes = depois.get(i.itemTemplateId)!;
    depois.set(i.itemTemplateId, {
      valor: i.valor === undefined ? antes.valor : (i.valor ?? "").trim() || null,
      foto: i.foto === undefined ? antes.foto : i.foto || null,
    });
  }
  const falta = primeiroObrigatorioFaltando(atual.itens.map((i) => i.itemTemplate), Object.fromEntries(depois));
  if (falta) return NextResponse.json({ erro: falta }, { status: 400 });

  const alertas = atual.itens.map((i) => itemGeraAlerta(i.itemTemplate, depois.get(i.itemTemplateId)!.valor));
  await prisma.$transaction([
    ...atual.itens.map((i, n) => prisma.checklistItemPreenchido.update({
      where: { id: i.id },
      data: { valor: depois.get(i.itemTemplateId)!.valor, foto: depois.get(i.itemTemplateId)!.foto, alerta: alertas[n] },
    })),
    prisma.checklistPreenchido.update({
      where: { id },
      data: {
        status: statusPelosAlertas(alertas),
        ...(d.observacaoGeral !== undefined && { observacaoGeral: (d.observacaoGeral ?? "").trim() || null }),
        ...(d.colaboradorId !== undefined && { colaboradorId: d.colaboradorId || null }),
        editadoEm: new Date(), editadoPorId: session.user!.id,
      },
    }),
  ]);
  return NextResponse.json(await carregar(id, empresaId));
}

/**
 * Excluir é reversível: inativa (o checklist sai da lista e das contagens; respostas e fotos ficam).
 * Inativar: Veículos › excluir. Repetir não muda a data nem o autor da primeira vez.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("veiculos", "excluir");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const atual = await prisma.checklistPreenchido.findFirst({ where: { id, empresaId: session.user!.empresaId }, select: { id: true, inativadoEm: true } });
  if (!atual) return NextResponse.json({ erro: "Checklist não encontrado" }, { status: 404 });
  if (!atual.inativadoEm) await prisma.checklistPreenchido.update({ where: { id }, data: { inativadoEm: new Date(), inativadoPorId: session.user!.id } });
  return NextResponse.json({ ok: true, ativo: false });
}

/** Reativar o checklist inativado ({ ativo: true }). Reativar: Veículos › gerenciar. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("veiculos", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  if ((await req.json().catch(() => ({})))?.ativo !== true) return NextResponse.json({ erro: "Ação inválida" }, { status: 400 });
  const atual = await prisma.checklistPreenchido.findFirst({ where: { id, empresaId: guard.session.user!.empresaId }, select: { id: true } });
  if (!atual) return NextResponse.json({ erro: "Checklist não encontrado" }, { status: 404 });
  await prisma.checklistPreenchido.update({ where: { id }, data: { inativadoEm: null, inativadoPorId: null } });
  return NextResponse.json({ ok: true, ativo: true });
}
