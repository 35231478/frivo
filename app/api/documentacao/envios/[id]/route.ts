import { detalheDoEnvio } from "@/lib/documentacao/pacote-server";
import { guardaDeEnvio, responderEnvio } from "@/lib/documentacao/pacote-rotas";

type Params = { params: Promise<{ id: string }> };

/** O envio inteiro: os arquivos, a situação do link e a linha do tempo (empresa e cliente). */
export async function GET(_req: Request, { params }: Params) {
  const { ator, resposta } = await guardaDeEnvio();
  if (!ator) return resposta;
  const { id } = await params;
  return responderEnvio(() => detalheDoEnvio(id, ator.empresaId));
}
