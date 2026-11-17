import { type NextRequest } from "next/server";
import { gerarLink } from "@/lib/documentacao/pacote-server";
import { corpo, guardaDeEnvio, responderEnvio } from "@/lib/documentacao/pacote-rotas";

type Params = { params: Promise<{ id: string }> };

/**
 * Gera o link de um pacote que nasceu em zip, ou um link NOVO no lugar do que expirou ou foi
 * revogado. Link ativo não é trocado. Se algo venceu desde o envio, o pacote não ganha link novo.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { ator, resposta } = await guardaDeEnvio();
  if (!ator) return resposta;
  const { id } = await params;
  const b = await corpo(req);
  return responderEnvio(() => gerarLink(id, b.validadeDias, ator));
}
