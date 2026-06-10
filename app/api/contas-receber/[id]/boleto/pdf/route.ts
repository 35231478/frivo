import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { baixarPdfBoletoInter } from "@/lib/inter-api";

type Params = { params: Promise<{ id: string }> };

/** Retorna o PDF do boleto em base64 (data URL). */
export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "visualizar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const empresaId = guard.session.user.empresaId;

  const conta = await prisma.contaReceber.findFirst({ where: { id, empresaId } });
  if (!conta?.boletoId) return NextResponse.json({ erro: "Nenhum boleto emitido." }, { status: 404 });

  try {
    const pdf = await baixarPdfBoletoInter(empresaId, conta.boletoId);
    return NextResponse.json({ pdf });
  } catch (e: any) {
    return NextResponse.json({ erro: e?.message ?? "Erro ao baixar PDF." }, { status: 502 });
  }
}
