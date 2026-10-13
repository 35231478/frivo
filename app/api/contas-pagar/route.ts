import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { contaPagarSchema } from "@/lib/validations";
import { exigirPermissao } from "@/lib/permissoes-server";
import { proximoNumeroContaPagar } from "@/lib/financeiro-server";
import { categoriaParaGravar, fornecedorParaGravar, respostaRefEmpresa } from "@/lib/ref-empresa";

export async function GET() {
  const guard = await exigirPermissao("financeiro", "visualizar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user.empresaId;

  const contas = await prisma.contaPagar.findMany({
    where: { empresaId },
    include: {
      pedidoCompra: { select: { numero: true } },
      categoriaFinanceira: { select: { id: true, nome: true, cor: true, ativo: true } },
      fornecedorCadastro: { select: { id: true, nome: true, documento: true, ativo: true } },
    },
    orderBy: [{ dataVencimento: "asc" }, { criadoEm: "desc" }],
    take: 300,
  });
  return NextResponse.json(contas);
}

export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("financeiro", "fluxoCaixa");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user.empresaId;

  const parsed = contaPagarSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;

  if (!d.fornecedorId) return NextResponse.json({ erro: "Escolha o fornecedor (cadastre-o em Financeiro › Fornecedores se ainda não existir)." }, { status: 400 });

  let categoria: Awaited<ReturnType<typeof categoriaParaGravar>>;
  let fornecedor: Awaited<ReturnType<typeof fornecedorParaGravar>>;
  try {
    [categoria, fornecedor] = await Promise.all([categoriaParaGravar(d.categoriaId, empresaId), fornecedorParaGravar(d.fornecedorId, empresaId)]);
  } catch (e) { const r = respostaRefEmpresa(e); if (r) return r; throw e; }

  const numero = await proximoNumeroContaPagar(empresaId, new Date().getFullYear());
  const conta = await prisma.contaPagar.create({
    data: {
      empresaId,
      numero,
      // Vínculo pelo ID; nome/CNPJ copiados do cadastro só como histórico
      fornecedorId: fornecedor.fornecedorId,
      fornecedor: fornecedor.nome ?? "",
      fornecedorCnpj: fornecedor.documento ?? null,
      descricao: d.descricao,
      valorTotal: d.valorTotal,
      valorPago: 0,
      saldoRestante: d.valorTotal,
      status: "PENDENTE",
      dataVencimento: d.dataVencimento ? new Date(d.dataVencimento) : null,
      formaPagamento: d.formaPagamento || null,
      banco: d.banco || null,
      pedidoCompraId: d.pedidoCompraId || null,
      observacao: d.observacao || null,
      categoriaId: categoria.categoriaId ?? null,
    },
  });
  return NextResponse.json(conta, { status: 201 });
}
