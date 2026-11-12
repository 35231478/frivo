import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { respostaAnexo } from "@/lib/anexos-server";

type Params = { params: Promise<{ id: string }> };

/** A imagem de uma foto de atendimento (execução da OS e histórico do equipamento), da empresa da sessão. */
export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirAlgumaPermissao([["ordens", "visualizar"], ["equipamentos", "visualizar"]]);
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const foto = await prisma.fotoAtendimento.findFirst({ where: { id, empresaId: guard.session.user!.empresaId }, select: { url: true } });
  if (!foto) return NextResponse.json({ erro: "Foto não encontrada" }, { status: 404 });
  return respostaAnexo({ nome: `foto-${id}.jpg`, conteudo: foto.url }, true);
}
