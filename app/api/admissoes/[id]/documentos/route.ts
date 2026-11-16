import { NextResponse, type NextRequest } from "next/server";
import { respostaZip } from "@/lib/pdf/resposta";
import { guardaDoRh } from "@/lib/admissao/admissao-rotas";
import { ErroEntrega, pacoteDaAdmissao } from "@/lib/admissao/admissao-entrega-server";

type Params = { params: Promise<{ id: string }> };

/**
 * O pacote (zip) da admissão: a ficha, o contrato assinado e os documentos que o colaborador
 * enviou, com nomes que dizem o que cada arquivo é. É o que vai inteiro para o contador.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { ator, resposta } = await guardaDoRh();
  if (!ator) return resposta;
  const { id } = await params;
  try {
    return respostaZip(await pacoteDaAdmissao(id, ator.empresaId));
  } catch (e) {
    if (e instanceof ErroEntrega) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
