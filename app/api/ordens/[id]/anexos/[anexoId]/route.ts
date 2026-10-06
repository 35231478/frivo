import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { osDaEmpresa } from "@/lib/os-server";
import { respostaAnexo } from "@/lib/anexos-server";

type Params = { params: Promise<{ id: string; anexoId: string }> };

/** Baixa o anexo (?inline=1 abre no navegador — só imagem comum/PDF; o resto é sempre download). */
export async function GET(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "visualizar");
  if (guard.erro) return guard.resposta;
  const { id, anexoId } = await params;
  if (!(await osDaEmpresa(id, guard.session.user!.empresaId))) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });

  const anexo = await prisma.osAnexo.findFirst({ where: { id: anexoId, ordemServicoId: id } });
  if (!anexo) return NextResponse.json({ erro: "Anexo não encontrado" }, { status: 404 });

  // Data URL (base64); o tipo servido vem dos bytes, não do que foi gravado
  return respostaAnexo(anexo, req.nextUrl.searchParams.get("inline") === "1");
}

/** Exclui o anexo da OS (registra no histórico). */
export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id, anexoId } = await params;
  if (!(await osDaEmpresa(id, session.user!.empresaId))) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });

  const anexo = await prisma.osAnexo.findFirst({ where: { id: anexoId, ordemServicoId: id }, select: { id: true, nome: true } });
  if (!anexo) return NextResponse.json({ erro: "Anexo não encontrado" }, { status: 404 });

  await prisma.osAnexo.delete({ where: { id: anexoId } });
  await prisma.osHistorico.create({
    data: { ordemServicoId: id, usuarioId: session.user!.id, acao: "Anexo excluído", detalhes: anexo.nome },
  });
  return NextResponse.json({ ok: true });
}
