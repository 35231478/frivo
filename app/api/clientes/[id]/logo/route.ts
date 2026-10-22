import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { validarArquivoUpload } from "@/lib/anexos-server";
import { TIPOS_IMAGEM } from "@/lib/anexos";

type Params = { params: Promise<{ id: string }> };

const MAX_LOGO_SIZE = 2 * 1024 * 1024; // 2 MB

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!pode(session.user!.permissoes, "clientes", "editar", session.user!.role))
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const cliente = await prisma.cliente.findFirst({ where: { id, empresaId } });
  if (!cliente) return NextResponse.json({ erro: "Cliente não encontrado" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("logo") as File | null;

  if (!file) {
    return NextResponse.json({ erro: "Nenhum arquivo enviado." }, { status: 400 });
  }

  // Tipo decidido pelos BYTES (SVG/HTML disfarçado de imagem é recusado); grava o data URL normalizado
  const r = await validarArquivoUpload(file, {
    tipos: TIPOS_IMAGEM, tamanhoMax: MAX_LOGO_SIZE,
    mensagemTipo: "Envie apenas imagens (PNG, JPG, WEBP).",
  });
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 400 });
  const logo = r.arquivo.conteudo;

  await prisma.cliente.update({ where: { id }, data: { logo } });

  return NextResponse.json({ logo });
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!pode(session.user!.permissoes, "clientes", "editar", session.user!.role))
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const cliente = await prisma.cliente.findFirst({ where: { id, empresaId } });
  if (!cliente) return NextResponse.json({ erro: "Cliente não encontrado" }, { status: 404 });

  await prisma.cliente.update({ where: { id }, data: { logo: null } });
  return NextResponse.json({ ok: true });
}
