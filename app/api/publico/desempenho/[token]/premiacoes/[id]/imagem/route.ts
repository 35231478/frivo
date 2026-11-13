import { NextRequest, NextResponse } from "next/server";
import { bytesDaImagem } from "@/lib/desempenho/premiacoes-server";
import { imagemDaTv } from "@/lib/desempenho/servidor";

/** A imagem do brinde para a TV: só com o link válido da empresa dona da premiação. */
export async function GET(_: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const imagem = await imagemDaTv(token, id);
  const arquivo = imagem ? bytesDaImagem(imagem) : null;
  if (!arquivo) return NextResponse.json({ erro: "Imagem não encontrada" }, { status: 404 });
  return new NextResponse(new Uint8Array(arquivo.bytes), { headers: { "Content-Type": arquivo.tipo, "Cache-Control": "no-store" } });
}
