import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { categoriaParaGravar, centroCustoParaGravar, contaBancariaParaGravar, respostaRefEmpresa } from "@/lib/ref-empresa";
import { registrarEventoCR } from "@/lib/financeiro/conta-receber-server";
import { z } from "zod";
import { exigirPermissao } from "@/lib/permissoes-server";
import { proximoNumeroContaReceber } from "@/lib/financeiro-server";
import { anoBR } from "@/lib/fuso";
import { ErroConta, parcelarConta, planoSchema } from "@/lib/financeiro/parcelas-server";

const schema = z.object({
  clienteId: z.string().min(1, "Cliente é obrigatório"),
  descricao: z.string().min(1, "Descrição é obrigatória"),
  // Categoria financeira pelo ID (o nome não é mais aceito: renomear a categoria desligava as contas)
  categoriaId: z.string().optional().nullable(),
  valor: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().positive("Valor deve ser maior que zero")),
  dataVencimento: z.string().optional().nullable(),
  formaPagamento: z.enum(["BOLETO", "PIX", "TRANSFERENCIA", "DINHEIRO", "CARTAO", "CHEQUE"]).optional().nullable(),
  banco: z.string().optional().nullable(),
  observacao: z.string().max(2000).optional().nullable(),
  centroCustoId: z.string().optional().nullable(),
  contaBancariaId: z.string().optional().nullable(),
  /** Já nasce parcelada (2+ parcelas: vencimento + valor; a soma tem que ser o valor) */
  parcelas: planoSchema.optional().nullable(),
});

export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("financeiro", "contasReceber");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user.empresaId;

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;

  const cliente = await prisma.cliente.findFirst({ where: { id: d.clienteId, empresaId }, select: { cpfCnpj: true } });
  if (!cliente) return NextResponse.json({ erro: "Cliente não encontrado" }, { status: 404 });

  let categoria: Awaited<ReturnType<typeof categoriaParaGravar>>;
  let centro: Awaited<ReturnType<typeof centroCustoParaGravar>>;
  let contaBancaria: Awaited<ReturnType<typeof contaBancariaParaGravar>>;
  try {
    categoria = await categoriaParaGravar(d.categoriaId, empresaId);
    centro = await centroCustoParaGravar(d.centroCustoId, empresaId);
    contaBancaria = await contaBancariaParaGravar(d.contaBancariaId, empresaId);
  } catch (e) { const r = respostaRefEmpresa(e); if (r) return r; throw e; }

  const parcelado = (d.parcelas?.length ?? 0) > 1;
  const numero = await proximoNumeroContaReceber(empresaId, anoBR());
  const dados = {
      empresaId,
      clienteId: d.clienteId,
      numero,
      descricao: d.descricao,
      categoriaId: categoria.categoriaId ?? null,
      categoria: categoria.nome ?? null,
      valor: d.valor,
      status: "A_RECEBER" as const,
      // Parcelada: o vencimento do lançamento é o da 1ª parcela
      dataVencimento: parcelado ? new Date(d.parcelas![0].vencimento) : d.dataVencimento ? new Date(d.dataVencimento) : null,
      formaPagamento: d.formaPagamento || null,
      banco: contaBancaria.banco ?? (d.banco || null),
      centroCustoId: centro.centroCustoId ?? null,
      contaBancariaId: contaBancaria.contaBancariaId ?? null,
      clienteCnpj: cliente.cpfCnpj,
      observacao: d.observacao || null,
  };
  if (!parcelado) {
    const conta = await prisma.contaReceber.create({ data: dados });
    await registrarEventoCR({ empresaId, contaReceberId: conta.id, tipo: "CRIADA", detalhe: "Lançamento manual", usuarioId: guard.session.user.id });
    return NextResponse.json(conta, { status: 201 });
  }
  // Nasce parcelada: a conta (o lançamento) e as parcelas na MESMA transação — ou tudo, ou nada
  try {
    const r = await prisma.$transaction(async (tx) => {
      const conta = await tx.contaReceber.create({ data: dados });
      await registrarEventoCR({ empresaId, contaReceberId: conta.id, tipo: "CRIADA", detalhe: "Lançamento manual", usuarioId: guard.session.user.id }, tx);
      const parcelas = await parcelarConta(tx, { empresaId, contaId: conta.id, parcelas: d.parcelas!, usuarioId: guard.session.user.id });
      return { ...conta, parcelas: parcelas.map((x) => ({ id: x.id, numero: x.numero })) };
    }, { timeout: 20_000 });
    return NextResponse.json(r, { status: 201 });
  } catch (e) {
    if (e instanceof ErroConta) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
