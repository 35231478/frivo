import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { contaReceberUpdateSchema } from "@/lib/validations";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.contaReceber.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const parsed = contaReceberUpdateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const atualizada = await prisma.contaReceber.update({
    where: { id },
    data: {
      status: d.status,
      formaPagamento: d.formaPagamento ?? undefined,
      observacao: d.observacao ?? undefined,
      dataVencimento: d.dataVencimento ? new Date(d.dataVencimento) : undefined,
      dataRecebimento:
        d.status === "RECEBIDO"
          ? (d.dataRecebimento ? new Date(d.dataRecebimento) : new Date())
          : d.dataRecebimento === null
            ? null
            : undefined,
    },
  });

  return NextResponse.json(atualizada);
}
