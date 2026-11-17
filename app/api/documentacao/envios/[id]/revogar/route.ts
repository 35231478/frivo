import { revogarLink } from "@/lib/documentacao/pacote-server";
import { guardaDeEnvio, responderEnvio } from "@/lib/documentacao/pacote-rotas";

type Params = { params: Promise<{ id: string }> };

/** Revoga o link: ele para de abrir na hora. O envio e a linha do tempo continuam no histórico. */
export async function POST(_req: Request, { params }: Params) {
  const { ator, resposta } = await guardaDeEnvio();
  if (!ator) return resposta;
  const { id } = await params;
  return responderEnvio(() => revogarLink(id, ator));
}
