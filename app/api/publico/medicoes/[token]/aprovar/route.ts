import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { aprovacaoMedicaoSchema } from "@/lib/validations";
import { aprovarMedicao } from "@/lib/faturamento/aprovar-medicao-server";

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
  // Atômico: dois envios da aprovação (clique duplo/outra aba) — só o primeiro muda o status (núcleo único)
  const aprovada = await aprovarMedicao(medicao.id, { assinadoPor: parsed.data.nome.trim(), assinadoCpf: cpfLimpo, assinaturaUrl: parsed.data.assinaturaUrl });
  if (!aprovada) return NextResponse.json({ erro: "Esta medição não está disponível para aprovação" }, { status: 400 });

  return NextResponse.json({ ok: true, status: aprovada.status });
}
