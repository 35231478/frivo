import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const orcamento = await prisma.orcamento.findUnique({
    where: { tokenPublico: token },
    include: {
      empresa: {
        select: {
          nome: true, nomeFantasia: true, cnpj: true, email: true, telefone: true, celular: true,
          site: true, logo: true, endereco: true, numero: true, complemento: true, bairro: true,
          cidade: true, estado: true, cep: true,
        },
      },
      cliente: {
        select: {
          nome: true, nomeFantasia: true, cpfCnpj: true, email: true, telefone: true,
          endereco: true, numero: true, complemento: true, bairro: true, cidade: true, estado: true, cep: true,
        },
      },
      servicos: { orderBy: { ordem: "asc" } },
      produtos: { orderBy: { ordem: "asc" } },
    },
  });

  if (!orcamento) return NextResponse.json({ erro: "Orçamento não encontrado" }, { status: 404 });
  if (orcamento.status === "CANCELADO") {
    return NextResponse.json({ erro: "Orçamento cancelado" }, { status: 410 });
  }

  // Registra a primeira visualização do cliente (usado para parar lembretes)
  if (!orcamento.visualizadoEm) {
    await prisma.orcamento.update({ where: { id: orcamento.id }, data: { visualizadoEm: new Date() } });
  }

  return NextResponse.json(orcamento);
}
