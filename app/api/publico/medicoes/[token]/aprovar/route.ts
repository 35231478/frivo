import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { aprovacaoMedicaoSchema } from "@/lib/validations";
import { statusAposAprovacao, calcularVencimento } from "@/lib/medicao-helpers";
import { gerarContaReceberDaMedicao } from "@/lib/financeiro-server";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = aprovacaoMedicaoSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { erro: "Dados de aprovação inválidos", detalhes: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const medicao = await prisma.medicao.findUnique({
    where: { tokenPublico: token },
    include: { cliente: true },
  });
  if (!medicao) return NextResponse.json({ erro: "Medição não encontrada" }, { status: 404 });
  if (medicao.status !== "AGUARDANDO_APROVACAO") {
    return NextResponse.json({ erro: "Esta medição não está disponível para aprovação" }, { status: 400 });
  }

  const cpfLimpo = parsed.data.cpf.replace(/\D/g, "");
  const proximo = statusAposAprovacao(medicao.cliente.exigePcAntesNf);
  const vencimento = calcularVencimento(medicao.cliente.diaFaturamento, medicao.mes, medicao.ano);

  await prisma.medicao.update({
    where: { id: medicao.id },
    data: {
      status: proximo,
      dataAprovacao: new Date(),
      dataVencimento: vencimento,
      assinadoPor: parsed.data.nome.trim(),
      assinadoCpf: cpfLimpo,
      assinaturaUrl: parsed.data.assinaturaUrl,
    },
  });

  await gerarContaReceberDaMedicao(medicao.id);

  return NextResponse.json({ ok: true, status: proximo });
}
