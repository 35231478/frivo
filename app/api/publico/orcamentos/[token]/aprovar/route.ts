import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { aprovacaoPublicaSchema } from "@/lib/validations";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.json();

  const parsed = aprovacaoPublicaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { erro: "Dados de aprovação inválidos", detalhes: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const orcamento = await prisma.orcamento.findUnique({ where: { tokenPublico: token } });
  if (!orcamento) return NextResponse.json({ erro: "Orçamento não encontrado" }, { status: 404 });
  if (orcamento.status !== "ENVIADO") {
    return NextResponse.json(
      { erro: "Este orçamento não está disponível para aprovação" },
      { status: 400 }
    );
  }
  if (orcamento.validadeEm && orcamento.validadeEm < new Date()) {
    return NextResponse.json({ erro: "Orçamento expirado" }, { status: 410 });
  }

  const cpfLimpo = parsed.data.cpf.replace(/\D/g, "");

  const aprovado = await prisma.orcamento.update({
    where: { id: orcamento.id },
    data: {
      status: "APROVADO",
      assinadoEm: new Date(),
      assinadoPor: parsed.data.nome.trim(),
      assinadoCpf: cpfLimpo,
      assinaturaUrl: parsed.data.assinaturaUrl,
    },
  });

  return NextResponse.json({ ok: true, status: aprovado.status });
}
