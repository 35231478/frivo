import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { osDaEmpresa } from "@/lib/os-server";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  if (!(await osDaEmpresa(id, session.user!.empresaId))) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("arquivo") as File | null;
  if (!file) return NextResponse.json({ erro: "Nenhum arquivo enviado." }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ erro: "Máximo 5 MB." }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const conteudo = `data:${file.type};base64,${buffer.toString("base64")}`;

  const anexo = await prisma.osAnexo.create({
    data: { ordemServicoId: id, nome: file.name, tipo: file.type, tamanho: file.size, conteudo },
    select: { id: true, nome: true, tipo: true, tamanho: true, criadoEm: true },
  });

  await prisma.osHistorico.create({
    data: { ordemServicoId: id, usuarioId: session.user!.id, acao: "Anexo adicionado", detalhes: file.name },
  });

  return NextResponse.json(anexo, { status: 201 });
}
