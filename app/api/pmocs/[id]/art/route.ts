import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";

/** Baixa o arquivo da ART (?inline=1 abre no navegador). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("pmoc", "visualizar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const p = await prisma.pmoc.findFirst({ where: { id, empresaId: guard.session.user!.empresaId }, select: { artArquivo: true, artArquivoNome: true } });
  const m = p?.artArquivo ? /^data:([^;,]+);base64,([\s\S]*)$/.exec(p.artArquivo) : null;
  if (!m) return NextResponse.json({ erro: "Este PMOC não tem arquivo de ART." }, { status: 404 });
  const nome = encodeURIComponent(p!.artArquivoNome ?? "ART");
  const disp = req.nextUrl.searchParams.get("inline") === "1" ? "inline" : "attachment";
  return new NextResponse(Buffer.from(m[2], "base64"), {
    headers: { "Content-Type": m[1], "Content-Disposition": `${disp}; filename*=UTF-8''${nome}`, "Cache-Control": "private, no-store" },
  });
}
