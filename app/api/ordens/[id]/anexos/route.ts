import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { osDaEmpresa } from "@/lib/os-server";
import { validarArquivoUpload } from "@/lib/anexos-server";

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
  // Tipo decidido pelo conteúdo (não pelo que o navegador declara): bloqueia HTML/SVG/scripts
  const v = await validarArquivoUpload(file);
  if (!v.ok) return NextResponse.json({ erro: v.erro }, { status: 400 });
  const { nome, tipo, tamanho, conteudo } = v.arquivo;

  const anexo = await prisma.osAnexo.create({
    data: { ordemServicoId: id, nome, tipo, tamanho, conteudo },
    select: { id: true, nome: true, tipo: true, tamanho: true, criadoEm: true },
  });

  await prisma.osHistorico.create({
    data: { ordemServicoId: id, usuarioId: session.user!.id, acao: "Anexo adicionado", detalhes: nome },
  });

  return NextResponse.json(anexo, { status: 201 });
}
