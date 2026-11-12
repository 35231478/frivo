import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { validarArquivoUpload } from "@/lib/anexos-server";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!pode(session.user!.permissoes, "clientes", "visualizar", session.user!.role))
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const cliente = await prisma.cliente.findFirst({ where: { id, empresaId } });
  if (!cliente) return NextResponse.json({ erro: "Cliente não encontrado" }, { status: 404 });

  const anexos = await prisma.anexoCliente.findMany({
    where: { clienteId: id, empresaId },
    select: { id: true, nome: true, tipo: true, tamanho: true, criadoEm: true },
    orderBy: { criadoEm: "desc" },
  });

  return NextResponse.json(anexos);
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  if (!pode(session.user!.permissoes, "clientes", "editar", session.user!.role))
    return NextResponse.json({ erro: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const cliente = await prisma.cliente.findFirst({ where: { id, empresaId } });
  if (!cliente) return NextResponse.json({ erro: "Cliente não encontrado" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("arquivo") as File | null;

  if (!file) {
    return NextResponse.json({ erro: "Nenhum arquivo enviado." }, { status: 400 });
  }

  // Tipo decidido pelo conteúdo (não pelo que o navegador declara)
  const v = await validarArquivoUpload(file);
  if (!v.ok) return NextResponse.json({ erro: v.erro }, { status: 400 });
  const { nome, tipo, tamanho, conteudo } = v.arquivo;

  const anexo = await prisma.anexoCliente.create({
    data: {
      empresaId,
      clienteId: id,
      nome,
      tipo,
      tamanho,
      conteudo,
    },
    select: { id: true, nome: true, tipo: true, tamanho: true, criadoEm: true },
  });

  return NextResponse.json(anexo, { status: 201 });
}
