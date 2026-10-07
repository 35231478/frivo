import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { respostaRefEmpresa, validarRefEmpresa } from "@/lib/ref-empresa";
import { exigirPermissao } from "@/lib/permissoes-server";
import { checklistPreenchidoSchema } from "@/lib/validations";

export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("veiculos", "visualizar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { searchParams } = new URL(req.url);
  const veiculoId = searchParams.get("veiculoId");

  const checklists = await prisma.checklistPreenchido.findMany({
    where: { empresaId, ...(veiculoId && { veiculoId }) },
    include: {
      veiculo: { select: { placa: true, modelo: true } },
      colaborador: { select: { nome: true } },
      template: { select: { nome: true } },
      _count: { select: { itens: true } },
    },
    orderBy: { criadoEm: "desc" },
    take: 100,
  });

  return NextResponse.json(checklists);
}

export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("veiculos", "checklist");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;

  const body = await req.json();
  const parsed = checklistPreenchidoSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });

  const { veiculoId, templateId, observacaoGeral, itens } = parsed.data;
  const colaboradorId = (body.colaboradorId as string) || null;

  const veiculo = await prisma.veiculo.findFirst({ where: { id: veiculoId, empresaId } });
  if (!veiculo) return NextResponse.json({ erro: "Veículo não encontrado" }, { status: 404 });
  // Modelo de checklist e colaborador precisam ser da mesma empresa; os itens, do próprio modelo
  try {
    await Promise.all([
      validarRefEmpresa("checklistTemplate", templateId, empresaId, "Modelo de checklist"),
      validarRefEmpresa("tecnico", colaboradorId, empresaId, "Colaborador"),
    ]);
  } catch (e) { const r = respostaRefEmpresa(e); if (r) return r; throw e; }
  const itemIds = [...new Set(itens.map((i) => i.itemTemplateId))];
  // Itens do próprio modelo e ATIVOS (item removido na edição não entra em checklist novo)
  if (itemIds.length && (await prisma.checklistItemTemplate.count({ where: { id: { in: itemIds }, templateId, ativo: true } })) !== itemIds.length)
    return NextResponse.json({ erro: "Item de checklist inválido." }, { status: 400 });

  const temAlerta = itens.some((i) => i.alerta);
  const status = temAlerta ? "COM_ALERTAS" : "CONCLUIDO";

  const checklist = await prisma.checklistPreenchido.create({
    data: {
      empresaId,
      veiculoId,
      templateId,
      colaboradorId,
      status,
      observacaoGeral: observacaoGeral || null,
      itens: {
        create: itens.map((i) => ({
          itemTemplateId: i.itemTemplateId,
          valor: i.valor || null,
          foto: i.foto || null,
          alerta: i.alerta,
        })),
      },
    },
  });

  return NextResponse.json({ ...checklist, temAlerta }, { status: 201 });
}
