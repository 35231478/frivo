import { NextRequest, NextResponse } from "next/server";
import { erroDeValidacao } from "@/lib/forms/erros-server";
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
  // Por padrão só os ativos; ?inativos=1 devolve os inativados (para a aba "Inativos" e o Reativar)
  const inativos = searchParams.get("inativos") === "1";

  const checklists = await prisma.checklistPreenchido.findMany({
    where: { empresaId, inativadoEm: inativos ? { not: null } : null, ...(veiculoId && { veiculoId }) },
    select: {
      id: true, status: true, criadoEm: true, editadoEm: true, inativadoEm: true, observacaoGeral: true, veiculoId: true,
      veiculo: { select: { placa: true, modelo: true } },
      colaborador: { select: { nome: true } },
      template: { select: { nome: true } },
      inativadoPor: { select: { nome: true } },
      // sem as fotos (base64): a lista só precisa saber quantos itens e quantos em alerta
      itens: { select: { alerta: true } },
    },
    orderBy: { criadoEm: "desc" },
    take: 200,
  });

  return NextResponse.json(checklists.map(({ itens, ...c }) => ({ ...c, totalItens: itens.length, alertas: itens.filter((i) => i.alerta).length })));
}

export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("veiculos", "checklist");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;

  const body = await req.json().catch(() => null);
  const parsed = checklistPreenchidoSchema.safeParse(body);
  if (!parsed.success) return erroDeValidacao(parsed.error);

  const { veiculoId, templateId, observacaoGeral, itens } = parsed.data;
  const colaboradorId = ((body as { colaboradorId?: string }).colaboradorId as string) || null;

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
