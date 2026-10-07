import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { folhaColaboradorSchema } from "@/lib/folha/validacao";
import { calcularCusto } from "@/lib/folha/calculo";
import { dadosDoColaborador, garantirModelosPadrao, listarModelos, modeloAplicado } from "@/lib/folha/server";

/**
 * Seção "Dados financeiros / Folha" do colaborador. Só com "Financeiro › Custo de pessoal"
 * (salário, benefícios e encargos não aparecem para quem só gerencia colaboradores).
 */

type Params = { params: Promise<{ id: string }> };

const n = (v: unknown) => (v == null ? null : Number(v));

async function carregar(id: string, empresaId: string) {
  const c = await prisma.tecnico.findFirst({ where: { id, empresaId }, select: { id: true, nome: true, salario: true, folha: true } });
  if (!c) return null;
  await garantirModelosPadrao(empresaId);
  const modelos = (await listarModelos(empresaId)).filter((m) => m.ativo);
  const dados = dadosDoColaborador(c);
  const modelo = modeloAplicado(modelos, dados.regime, c.folha?.modeloEncargosId);
  const f = c.folha;
  return {
    colaborador: { id: c.id, nome: c.nome },
    folha: {
      regime: dados.regime,
      salario: n(c.salario),
      valorDiaria: n(f?.valorDiaria), diasMes: f?.diasMes ?? null, horasMes: f?.horasMes ?? null,
      adicionalTipo: f?.adicionalTipo ?? "NENHUM", adicionalPercent: n(f?.adicionalPercent), adicionalValor: n(f?.adicionalValor),
      horasExtrasValor: n(f?.horasExtrasValor),
      valeTransporte: n(f?.valeTransporte), descontaVt: f?.descontaVt ?? true,
      valeAlimentacao: n(f?.valeAlimentacao), planoSaude: n(f?.planoSaude), outrosBeneficios: n(f?.outrosBeneficios),
      descontos: n(f?.descontos), descontosDescricao: f?.descontosDescricao ?? null,
      modeloEncargosId: f?.modeloEncargosId ?? null, observacoes: f?.observacoes ?? null,
    },
    cadastrado: !!f,
    modelos: modelos.map((m) => ({ id: m.id, nome: m.nome, regime: m.regime, padrao: m.padrao, itens: m.itens })),
    custo: calcularCusto(dados, modelo?.itens ?? []),
    modeloAplicado: modelo?.nome ?? null,
  };
}

export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "folha");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const r = await carregar(id, guard.session.user!.empresaId);
  if (!r) return NextResponse.json({ erro: "Colaborador não encontrado" }, { status: 404 });
  return NextResponse.json(r);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "folha");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;

  const existe = await prisma.tecnico.findFirst({ where: { id, empresaId }, select: { id: true } });
  if (!existe) return NextResponse.json({ erro: "Colaborador não encontrado" }, { status: 404 });

  const parsed = folhaColaboradorSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const primeiro = parsed.error.issues[0];
    return NextResponse.json({ erro: primeiro?.message ?? "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }
  const { salario, modeloEncargosId, ...d } = parsed.data;

  // Modelo de encargos escolhido: precisa ser da mesma empresa e do mesmo regime
  if (modeloEncargosId) {
    const m = await prisma.modeloEncargos.findFirst({ where: { id: modeloEncargosId, empresaId }, select: { regime: true } });
    if (!m) return NextResponse.json({ erro: "Modelo de encargos inválido" }, { status: 400 });
    if (m.regime !== d.regime) return NextResponse.json({ erro: "O modelo de encargos é de outro tipo de contrato" }, { status: 400 });
  }

  const dados = {
    regime: d.regime,
    valorDiaria: d.valorDiaria ?? null, diasMes: d.diasMes ?? null,
    horasMes: d.horasMes ?? 220,
    adicionalTipo: d.adicionalTipo,
    adicionalPercent: d.adicionalTipo === "NENHUM" ? null : d.adicionalPercent ?? null,
    adicionalValor: d.adicionalTipo === "NENHUM" ? null : d.adicionalValor ?? null,
    horasExtrasValor: d.horasExtrasValor ?? null,
    valeTransporte: d.valeTransporte ?? null, descontaVt: d.descontaVt,
    valeAlimentacao: d.valeAlimentacao ?? null, planoSaude: d.planoSaude ?? null, outrosBeneficios: d.outrosBeneficios ?? null,
    descontos: d.descontos ?? null, descontosDescricao: d.descontosDescricao || null,
    modeloEncargosId: modeloEncargosId || null,
    observacoes: d.observacoes || null,
  };
  await prisma.$transaction([
    prisma.tecnico.update({ where: { id }, data: { salario: salario ?? null } }),
    prisma.colaboradorFolha.upsert({
      where: { colaboradorId: id },
      create: { ...dados, empresaId, colaboradorId: id },
      update: dados,
    }),
  ]);
  return NextResponse.json(await carregar(id, empresaId));
}
