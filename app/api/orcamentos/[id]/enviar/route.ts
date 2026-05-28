import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildPublicUrl, buildMailtoLink } from "@/lib/orcamento-helpers";
import { whatsappLink } from "@/lib/utils";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const empresaNome = session.user!.empresaNome;
  const { id } = await params;

  const orcamento = await prisma.orcamento.findFirst({
    where: { id, empresaId },
    include: { cliente: { select: { email: true, celular: true, telefone: true, nome: true } } },
  });
  if (!orcamento) return NextResponse.json({ erro: "Orçamento não encontrado" }, { status: 404 });
  if (orcamento.status === "APROVADO" || orcamento.status === "CANCELADO") {
    return NextResponse.json(
      { erro: "Orçamento já encerrado, não é possível reenviar" },
      { status: 400 }
    );
  }

  const atualizado = await prisma.orcamento.update({
    where: { id },
    data: {
      status: "ENVIADO",
      enviadoEm: orcamento.enviadoEm ?? new Date(),
    },
  });

  const origem = new URL(req.url).origin;
  const publicUrl = buildPublicUrl(orcamento.tokenPublico, origem);
  const emailDest = orcamento.cliente.email ?? "";
  const mailtoUrl = emailDest ? buildMailtoLink(emailDest, empresaNome, orcamento.codigo, publicUrl) : null;

  const telefone = orcamento.cliente.celular ?? orcamento.cliente.telefone ?? "";
  const msgWhats =
    `Olá! Segue o orçamento ${orcamento.codigo} de ${empresaNome}:\n${publicUrl}\n\n` +
    `Você pode aprová-lo digitalmente pelo link acima.`;
  const whatsappUrl = telefone ? whatsappLink(telefone, msgWhats) : null;

  return NextResponse.json({ orcamento: atualizado, publicUrl, mailtoUrl, whatsappUrl });
}
