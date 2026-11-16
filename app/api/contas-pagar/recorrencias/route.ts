import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { categoriaParaGravar, centroCustoParaGravar, fornecedorParaGravar, respostaRefEmpresa } from "@/lib/ref-empresa";
import { validarRegra } from "@/lib/financeiro/conta-pagar-recorrencia";
import { criarRecorrencia, ErroRecorrencia } from "@/lib/financeiro/conta-pagar-recorrencia-server";
import { recorrenciaSchema } from "@/lib/validations";

/**
 * DESPESAS RECORRENTES (contas a pagar) — a lista das regras e a criação.
 * Mexer em despesa recorrente é mexer em dinheiro: exige "Financeiro › Fluxo de caixa", a mesma
 * permissão de criar e editar conta a pagar.
 */

export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("financeiro", "visualizar");
  if (guard.erro) return guard.resposta;
  const situacao = req.nextUrl.searchParams.get("situacao");

  const regras = await prisma.contaPagarRecorrencia.findMany({
    where: { empresaId: guard.session.user.empresaId, ...(situacao ? { situacao } : {}) },
    include: {
      categoriaFinanceira: { select: { id: true, nome: true, cor: true, ativo: true } },
      centroCusto: { select: { id: true, nome: true, ativo: true } },
      fornecedorCadastro: { select: { id: true, nome: true, documento: true, ativo: true } },
      tecnico: { select: { id: true, nome: true, ativo: true } },
      _count: { select: { contas: true } },
    },
    orderBy: [{ situacao: "asc" }, { descricao: "asc" }],
    take: 300,
  });
  return NextResponse.json(regras);
}

export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("financeiro", "fluxoCaixa");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user.empresaId;

  const parsed = recorrenciaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const d = parsed.data;

  const erro = validarRegra(d);
  if (erro) return NextResponse.json({ erro }, { status: 400 });
  if (!d.fornecedorId && !d.tecnicoId) {
    return NextResponse.json({ erro: "Escolha o favorecido: um fornecedor ou um colaborador." }, { status: 400 });
  }

  let categoria: Awaited<ReturnType<typeof categoriaParaGravar>>;
  let centro: Awaited<ReturnType<typeof centroCustoParaGravar>>;
  let fornecedor: Awaited<ReturnType<typeof fornecedorParaGravar>> | null = null;
  try {
    [categoria, centro] = await Promise.all([
      categoriaParaGravar(d.categoriaId, empresaId), centroCustoParaGravar(d.centroCustoId, empresaId),
    ]);
    if (d.fornecedorId) fornecedor = await fornecedorParaGravar(d.fornecedorId, empresaId);
  } catch (e) { const r = respostaRefEmpresa(e); if (r) return r; throw e; }

  let favorecidoNome = fornecedor?.nome ?? "";
  if (d.tecnicoId) {
    const colaborador = await prisma.tecnico.findFirst({ where: { id: d.tecnicoId, empresaId }, select: { nome: true } });
    if (!colaborador) return NextResponse.json({ erro: "Colaborador não encontrado nesta empresa." }, { status: 400 });
    favorecidoNome = colaborador.nome;
  }

  try {
    const { regra, contas } = await criarRecorrencia(empresaId, {
      ...d,
      favorecidoNome,
      fornecedorId: fornecedor?.fornecedorId ?? null,
      categoriaId: categoria.categoriaId ?? null,
      centroCustoId: centro.centroCustoId ?? null,
    }, guard.session.user.id);
    return NextResponse.json({ ...regra, contasGeradas: contas }, { status: 201 });
  } catch (e) {
    if (e instanceof ErroRecorrencia) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
