import { type NextRequest } from "next/server";
import { lerSelecao, previaDoPacote } from "@/lib/documentacao/pacote-server";
import { corpo, guardaDeEnvio, responderEnvio } from "@/lib/documentacao/pacote-rotas";

/**
 * A prévia do pacote: o que entra, o que falta e o que está vencido — sem gravar nada. É o que a
 * tela mostra antes de a pessoa escolher como entregar.
 */
export async function POST(req: NextRequest) {
  const { ator, resposta } = await guardaDeEnvio();
  if (!ator) return resposta;
  const b = await corpo(req);
  return responderEnvio(() => previaDoPacote(ator.empresaId, lerSelecao(b)));
}
