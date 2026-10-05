import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { contaReceberUpdateSchema } from "@/lib/validations";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "contasReceber");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.contaReceber.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const parsed = contaReceberUpdateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const dataRecebimento =
    d.status === "RECEBIDO"
      ? (d.dataRecebimento ? new Date(d.dataRecebimento) : new Date())
      : d.dataRecebimento === null
        ? null
        : undefined;

  const atualizada = await prisma.contaReceber.update({
    where: { id },
    data: {
      status: d.status,
      descricao: d.descricao ?? undefined,
      categoria: d.categoria === undefined ? undefined : d.categoria || null,
      valor: d.valor ?? undefined,
      formaPagamento: d.formaPagamento ?? undefined,
      banco: d.banco === undefined ? undefined : d.banco || null,
      observacao: d.observacao ?? undefined,
      dataVencimento: d.dataVencimento ? new Date(d.dataVencimento) : undefined,
      dataRecebimento,
    },
  });

  // Ao quitar uma conta vinda de medição, marca a medição como PAGO.
  if (d.status === "RECEBIDO" && existente.medicaoId) {
    await prisma.medicao.updateMany({
      where: { id: existente.medicaoId, status: { notIn: ["PAGO", "CANCELADA"] } },
      data: { status: "PAGO", dataPagamento: dataRecebimento ?? new Date(), formaPagamento: d.formaPagamento ?? undefined },
    });
  }

  // Confirmação de pagamento por e-mail (a função verifica toggle + preferência do cliente)
  if (d.status === "RECEBIDO" && existente.status !== "RECEBIDO") {
    const { enviarConfirmacaoPagamento } = await import("@/lib/email");
    await enviarConfirmacaoPagamento(id).catch(() => {});
  }

  return NextResponse.json(atualizada);
}
