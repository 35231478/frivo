import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { categoriaParaGravar, centroCustoParaGravar, fornecedorParaGravar, respostaRefEmpresa } from "@/lib/ref-empresa";
import { validarRegra } from "@/lib/financeiro/conta-pagar-recorrencia";
import { atualizarRecorrencia, encerrarRecorrencia, ErroRecorrencia } from "@/lib/financeiro/conta-pagar-recorrencia-server";
import { recorrenciaUpdateSchema } from "@/lib/validations";

/**
 * Uma despesa recorrente: ver, editar a regra e ENCERRAR.
 * "Excluir" é encerrar: a regra para de gerar e as ocorrências futuras em aberto são canceladas —
 * o histórico (inclusive o que já foi pago) fica inteiro, e não sobra conta fantasma no fluxo.
 */
type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "visualizar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;

  const regra = await prisma.contaPagarRecorrencia.findFirst({
    where: { id, empresaId: guard.session.user.empresaId },
    include: {
      categoriaFinanceira: { select: { id: true, nome: true, cor: true, ativo: true } },
      centroCusto: { select: { id: true, nome: true, ativo: true } },
      fornecedorCadastro: { select: { id: true, nome: true, documento: true, ativo: true } },
      tecnico: { select: { id: true, nome: true, ativo: true } },
      contas: {
        orderBy: [{ refAno: "asc" }, { refMes: "asc" }],
        select: { id: true, numero: true, refAno: true, refMes: true, status: true, valorTotal: true, valorPago: true, valorEstimado: true, dataVencimento: true },
      },
    },
  });
  if (!regra) return NextResponse.json({ erro: "Não encontrada" }, { status: 404 });
  return NextResponse.json(regra);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "fluxoCaixa");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const empresaId = guard.session.user.empresaId;

  const atual = await prisma.contaPagarRecorrencia.findFirst({ where: { id, empresaId } });
  if (!atual) return NextResponse.json({ erro: "Não encontrada" }, { status: 404 });

  const parsed = recorrenciaUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const d = parsed.data;

  // a regra completa (a atual, com o que veio) precisa continuar válida
  const erro = validarRegra({
    descricao: d.descricao ?? atual.descricao,
    diaVencimento: d.diaVencimento ?? atual.diaVencimento,
    passoMeses: d.passoMeses ?? atual.passoMeses,
    valor: d.valor ?? Number(atual.valor),
    inicioAno: atual.inicioAno,
    inicioMes: atual.inicioMes,
    fimAno: d.fimAno === undefined ? atual.fimAno : d.fimAno,
    fimMes: d.fimMes === undefined ? atual.fimMes : d.fimMes,
    ocorrencias: d.ocorrencias === undefined ? atual.ocorrencias : d.ocorrencias,
  });
  if (erro) return NextResponse.json({ erro }, { status: 400 });

  let favorecidoNome: string | undefined;
  try {
    if (d.categoriaId !== undefined) d.categoriaId = (await categoriaParaGravar(d.categoriaId, empresaId, atual.categoriaId)).categoriaId ?? null;
    if (d.centroCustoId !== undefined) d.centroCustoId = (await centroCustoParaGravar(d.centroCustoId, empresaId, atual.centroCustoId)).centroCustoId ?? null;
    if (d.fornecedorId) {
      const f = await fornecedorParaGravar(d.fornecedorId, empresaId, atual.fornecedorId);
      d.fornecedorId = f.fornecedorId ?? null;
      favorecidoNome = f.nome ?? undefined;
    }
  } catch (e) { const r = respostaRefEmpresa(e); if (r) return r; throw e; }

  if (d.tecnicoId) {
    const colaborador = await prisma.tecnico.findFirst({ where: { id: d.tecnicoId, empresaId }, select: { nome: true } });
    if (!colaborador) return NextResponse.json({ erro: "Colaborador não encontrado nesta empresa." }, { status: 400 });
    favorecidoNome = colaborador.nome;
  }

  try {
    const r = await atualizarRecorrencia(empresaId, id, { ...d, ...(favorecidoNome ? { favorecidoNome } : {}) });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof ErroRecorrencia) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "fluxoCaixa");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const motivo = req.nextUrl.searchParams.get("motivo");

  try {
    const r = await encerrarRecorrencia(guard.session.user.empresaId, id, motivo);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof ErroRecorrencia) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
