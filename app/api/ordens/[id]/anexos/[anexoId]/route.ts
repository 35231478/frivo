import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { osDaEmpresa } from "@/lib/os-server";

type Params = { params: Promise<{ id: string; anexoId: string }> };

/** Baixa o anexo (?inline=1 abre no navegador, ex.: foto/PDF). */
export async function GET(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "visualizar");
  if (guard.erro) return guard.resposta;
  const { id, anexoId } = await params;
  if (!(await osDaEmpresa(id, guard.session.user!.empresaId))) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });

  const anexo = await prisma.osAnexo.findFirst({ where: { id: anexoId, ordemServicoId: id } });
  if (!anexo) return NextResponse.json({ erro: "Anexo não encontrado" }, { status: 404 });

  // Os anexos são guardados como data URL (base64)
  const m = anexo.conteudo.match(/^data:([^;,]*);base64,([\s\S]*)$/);
  const tipo = m?.[1] || anexo.tipo || "application/octet-stream";
  const bytes = Buffer.from(m ? m[2] : anexo.conteudo, "base64");
  const inline = req.nextUrl.searchParams.get("inline") === "1";
  const nome = encodeURIComponent(anexo.nome);
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": tipo,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${nome}`,
      "Cache-Control": "private, no-store",
    },
  });
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
