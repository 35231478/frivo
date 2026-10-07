import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { respostaRefEmpresa, validarCategoriaFinanceira } from "@/lib/ref-empresa";
import { z } from "zod";
import { exigirPermissao } from "@/lib/permissoes-server";
import { proximoNumeroContaReceber } from "@/lib/financeiro-server";

const schema = z.object({
  clienteId: z.string().min(1, "Cliente é obrigatório"),
  descricao: z.string().min(1, "Descrição é obrigatória"),
  categoria: z.string().optional().nullable(),
  valor: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().positive("Valor deve ser maior que zero")),
  dataVencimento: z.string().optional().nullable(),
  formaPagamento: z.enum(["BOLETO", "PIX", "TRANSFERENCIA", "DINHEIRO", "CARTAO", "CHEQUE"]).optional().nullable(),
  banco: z.string().optional().nullable(),
  observacao: z.string().optional().nullable(),
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

  try { await validarCategoriaFinanceira(d.categoria, empresaId); }
  catch (e) { const r = respostaRefEmpresa(e); if (r) return r; throw e; }

  const numero = await proximoNumeroContaReceber(empresaId, new Date().getFullYear());
  const conta = await prisma.contaReceber.create({
    data: {
      empresaId,
      clienteId: d.clienteId,
      numero,
      descricao: d.descricao,
      categoria: d.categoria || null,
      valor: d.valor,
      status: "A_RECEBER",
      dataVencimento: d.dataVencimento ? new Date(d.dataVencimento) : null,
      formaPagamento: d.formaPagamento || null,
      banco: d.banco || null,
      clienteCnpj: cliente.cpfCnpj,
      observacao: d.observacao || null,
    },
  });
  return NextResponse.json(conta, { status: 201 });
}
