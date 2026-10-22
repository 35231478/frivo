import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { respostaAnexo } from "@/lib/anexos-server";
import { exigirPermissao } from "@/lib/permissoes-server";

type Params = { params: Promise<{ id: string; anexoId: string }> };

/** Baixa o anexo (?inline=1 abre no navegador — só imagem comum/PDF; o resto é sempre download). */
export async function GET(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("contratos", "visualizar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id, anexoId } = await params;
  const empresaId = session.user!.empresaId;

  const anexo = await prisma.anexoContrato.findFirst({ where: { id: anexoId, contratoId: id, empresaId } });
  if (!anexo) return NextResponse.json({ erro: "Anexo não encontrado" }, { status: 404 });

  // Binário com o tipo decidido pelos BYTES (nosniff + sandbox) — resolve também o anexo grande
  // que estourava o limite de resposta quando ia como JSON base64
  return respostaAnexo(anexo, req.nextUrl.searchParams.get("inline") === "1");
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("contratos", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id, anexoId } = await params;
  const empresaId = session.user!.empresaId;

  const anexo = await prisma.anexoContrato.findFirst({ where: { id: anexoId, contratoId: id, empresaId } });
  if (!anexo) return NextResponse.json({ erro: "Anexo não encontrado" }, { status: 404 });

  await prisma.anexoContrato.delete({ where: { id: anexoId } });
  return NextResponse.json({ ok: true });
}
