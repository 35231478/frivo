import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { bytesDaImagem, imagemDaPremiacao } from "@/lib/desempenho/premiacoes-server";
import { tecnicoDaSessao } from "@/lib/tecnico/sessao";

/**
 * A imagem do prêmio em disputa, para a tela do colaborador no app. Não pede a permissão do módulo:
 * pede estar logado, ligado a um colaborador QUE PARTICIPA do Desempenho, e o prêmio ser da empresa dele.
 */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const negado = NextResponse.json({ erro: "Imagem não encontrada" }, { status: 404 });
  const tecnico = await tecnicoDaSessao(session);
  const { empresaId } = session.user;
  if (!tecnico || !(await prisma.desempenhoParticipante.count({ where: { tecnicoId: tecnico.id, empresaId } }))) return negado;
  const imagem = await imagemDaPremiacao(empresaId, (await params).id);
  const arquivo = imagem ? bytesDaImagem(imagem) : null;
  if (!arquivo) return negado;
  return new NextResponse(new Uint8Array(arquivo.bytes), { headers: { "Content-Type": arquivo.tipo, "Cache-Control": "private, max-age=60" } });
}
