import { NextResponse, type NextRequest } from "next/server";
import { respostaPdfArquivo } from "@/lib/pdf/resposta";
import { guardaDoRh } from "@/lib/admissao/admissao-rotas";
import { ErroEntrega, contratoDaAdmissao } from "@/lib/admissao/admissao-entrega-server";

type Params = { params: Promise<{ id: string }> };

/**
 * O contrato assinado em PDF: o texto congelado no momento da assinatura, mais a prova (nome, data
 * e hora, IP, navegador) e a foto tirada na hora. É o arquivo que responde "o que foi assinado?".
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { ator, resposta } = await guardaDoRh();
  if (!ator) return resposta;
  const { id } = await params;
  try {
    const contrato = await contratoDaAdmissao(id, ator.empresaId);
    return respostaPdfArquivo(contrato, req.nextUrl.searchParams.get("ver") === "1");
  } catch (e) {
    if (e instanceof ErroEntrega) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
