import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { bytesDaImagem, imagemDaPremiacao } from "@/lib/desempenho/premiacoes-server";

/** A imagem do brinde. "Desempenho › Visualizar". */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("desempenho", "visualizar");
  if (guard.erro) return guard.resposta;
  const imagem = await imagemDaPremiacao(guard.session.user.empresaId, (await params).id);
  const arquivo = imagem ? bytesDaImagem(imagem) : null;
  if (!arquivo) return NextResponse.json({ erro: "Imagem não encontrada" }, { status: 404 });
  return new NextResponse(new Uint8Array(arquivo.bytes), { headers: { "Content-Type": arquivo.tipo, "Cache-Control": "private, max-age=60" } });
}
