import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validarArquivoUpload } from "@/lib/anexos-server";
import { TIPOS_IMAGEM } from "@/lib/anexos";
import { exigirPermissao } from "@/lib/permissoes-server";

export async function PUT(req: NextRequest) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;

  const formData = await req.formData();
  const file = formData.get("logo") as File | null;
  if (!file) return NextResponse.json({ erro: "Envie apenas imagens." }, { status: 400 });
  // Tipo decidido pelos BYTES (SVG/HTML disfarçado de imagem é recusado); grava o data URL normalizado
  const r = await validarArquivoUpload(file, {
    tipos: TIPOS_IMAGEM, tamanhoMax: 2 * 1024 * 1024,
    mensagemTipo: "Envie apenas imagens (JPG, PNG ou WEBP).",
  });
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 400 });
  const logo = r.arquivo.conteudo;

  await prisma.empresa.update({ where: { id: session.user!.empresaId }, data: { logo } });
  return NextResponse.json({ logo });
}

export async function DELETE() {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;

  await prisma.empresa.update({ where: { id: session.user!.empresaId }, data: { logo: null } });
  return NextResponse.json({ ok: true });
}
