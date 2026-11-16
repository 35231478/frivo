import { NextRequest } from "next/server";
import { reenviarConvite } from "@/lib/admissao/admissao-server";
import { corpo, guardaDoRh, responderAdmissao } from "@/lib/admissao/admissao-rotas";

/**
 * Manda (ou remanda) o link ao colaborador: o e-mail sai pelo envio da empresa e a resposta traz o
 * WhatsApp com a mensagem pronta. Cada envio renova o prazo; um link expirado volta a valer.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ator, resposta } = await guardaDoRh();
  if (!ator) return resposta;
  const b = await corpo(req);
  return responderAdmissao(() => reenviarConvite(ator, id, new URL(req.url).origin, {
    validadeDias: typeof b.validadeDias === "number" ? b.validadeDias : null,
  }));
}
