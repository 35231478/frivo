import { type NextRequest } from "next/server";
import { corpo, guardaDeDocumentos, responderDocumento } from "@/lib/documentos/documentos-rotas";
import { assinarDocumento } from "@/lib/documentos/documentos-server";
import { ipDaRequisicao } from "@/lib/acesso/limite";

type Params = { params: Promise<{ id: string }> };

/**
 * A assinatura presencial, no aparelho de quem entrega: nome digitado e foto. O IP, o navegador e
 * a hora são do servidor — a mesma prova da admissão digital. Só depois disso o papel vira anexo
 * na ficha do colaborador.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { ator, resposta } = await guardaDeDocumentos();
  if (!ator) return resposta;
  const { id } = await params;
  const b = await corpo(req);
  return responderDocumento(() => assinarDocumento(
    id, ator.empresaId,
    { nome: String(b.nome ?? ""), selfie: String(b.selfie ?? "") },
    { ip: ipDaRequisicao(req.headers), userAgent: req.headers.get("user-agent") },
  ));
}
