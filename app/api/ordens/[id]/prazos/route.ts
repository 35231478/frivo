import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { osPrazoSchema } from "@/lib/validations";
import { montarEtapas } from "@/lib/prazo-helpers";
import { respostaRefEmpresa, validarRefEmpresa } from "@/lib/ref-empresa";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "visualizar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const os = await prisma.ordemServico.findFirst({ where: { id, empresaId }, select: { id: true } });
  if (!os) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });

  const prazos = await prisma.osPrazo.findMany({
    where: { ordemServicoId: id },
    include: { etapas: { orderBy: { ordem: "asc" } }, template: { select: { cor: true } } },
    orderBy: { criadoEm: "desc" },
  });
  return NextResponse.json(prazos);
}

export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const os = await prisma.ordemServico.findFirst({ where: { id, empresaId }, select: { id: true } });
  if (!os) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });

  const parsed = osPrazoSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  // Cada prazo novo é uma escolha NOVA: o modelo precisa ser da empresa e estar ativo. Prazos já
  // abertos com um modelo que depois foi inativado continuam (têm cópia das etapas).
  try { await validarRefEmpresa("prazoTemplate", parsed.data.templateId, empresaId, "Modelo de prazo", { novoAtivo: true }); }
  catch (e) { const r = respostaRefEmpresa(e); if (r) return r; throw e; }

  const template = await prisma.prazoTemplate.findFirst({
    where: { id: parsed.data.templateId, empresaId },
    include: { etapas: { orderBy: { ordem: "asc" } } },
  });
  if (!template) return NextResponse.json({ erro: "Template inválido" }, { status: 400 });
  if (template.etapas.length === 0) {
    return NextResponse.json({ erro: "Template não possui etapas" }, { status: 400 });
  }

  const etapas = montarEtapas(template.etapas, new Date());

  const prazo = await prisma.osPrazo.create({
    data: {
      ordemServicoId: id,
      templateId: template.id,
      nome: parsed.data.nome?.trim() || template.nome,
      status: "ATIVO",
      etapaAtual: 0,
      etapas: {
        create: etapas.map((e) => ({
          nome: e.nome,
          prazoHoras: e.prazoHoras,
          prazoLimite: e.prazoLimite,
          status: e.status,
          responsavel: e.responsavel,
          canal: e.canal,
          mensagem: e.mensagem,
          ordem: e.ordem,
        })),
      },
    },
    include: { etapas: { orderBy: { ordem: "asc" } } },
  });

  return NextResponse.json(prazo, { status: 201 });
}
