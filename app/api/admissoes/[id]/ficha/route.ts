import { NextResponse, type NextRequest } from "next/server";
import { respostaPdfArquivo } from "@/lib/pdf/resposta";
import { guardaDoRh } from "@/lib/admissao/admissao-rotas";
import { ErroEntrega, fichaDaAdmissao } from "@/lib/admissao/admissao-entrega-server";

type Params = { params: Promise<{ id: string }> };

/**
 * A Ficha de Admissão em PDF, no formato do eSocial (S-2200), para o RH mandar ao contador.
 *
 * `?ver=1` abre no navegador; sem isso, baixa. Admissão de outra empresa é 404 — nunca o arquivo.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { ator, resposta } = await guardaDoRh();
  if (!ator) return resposta;
  const { id } = await params;
  try {
    const ficha = await fichaDaAdmissao(id, ator.empresaId);
    return respostaPdfArquivo(ficha, req.nextUrl.searchParams.get("ver") === "1");
  } catch (e) {
    if (e instanceof ErroEntrega) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
