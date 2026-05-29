import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { aprovacaoRelatorioSchema } from "@/lib/validations";
import { criarMedicaoDeRelatorio } from "@/lib/financeiro-server";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = aprovacaoRelatorioSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados de aprovação inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  const relatorio = await prisma.relatorioOs.findUnique({ where: { tokenPublico: token } });
  if (!relatorio) return NextResponse.json({ erro: "Relatório não encontrado" }, { status: 404 });
  if (relatorio.status === "APROVADO") {
    return NextResponse.json({ erro: "Relatório já aprovado" }, { status: 400 });
  }
  if (relatorio.status === "REPROVADO") {
    return NextResponse.json({ erro: "Relatório reprovado" }, { status: 400 });
  }

  const cpfLimpo = parsed.data.cpf.replace(/\D/g, "");

  await prisma.relatorioOs.update({
    where: { id: relatorio.id },
    data: {
      status: "APROVADO",
      assinadoEm: new Date(),
      assinadoPor: parsed.data.nome.trim(),
      assinadoCpf: cpfLimpo,
      assinaturaUrl: parsed.data.assinaturaUrl,
    },
  });

  // Cria a medição financeira automaticamente (status conforme perfil do cliente)
  await criarMedicaoDeRelatorio(relatorio.id);

  return NextResponse.json({ ok: true, status: "APROVADO" });
}
