import { NextRequest, NextResponse } from "next/server";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { respostaAnexo } from "@/lib/anexos-server";
import { escopoDaSessao, filtroEscopo } from "@/lib/tecnico/escopo";

type Params = { params: Promise<{ id: string }> };

/** A imagem de uma foto de serviço adicional, da empresa da sessão. */
export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirAlgumaPermissao([["ordens", "visualizar"], ["equipamentos", "visualizar"]]);
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const escopo = escopoDaSessao(guard.session);
  const foto = await prisma.servicoAdicionalFoto.findFirst({
    where: { id, empresaId: guard.session.user.empresaId, ...(escopo.restrito && { servico: { atividade: filtroEscopo(escopo) } }) },
    select: { url: true },
  });
  if (!foto) return NextResponse.json({ erro: "Foto não encontrada" }, { status: 404 });
  return respostaAnexo({ nome: `adicional-${id}.jpg`, conteudo: foto.url }, true);
}
