import { invalidarConvite } from "@/lib/admissao/admissao-server";
import { guardaDoRh, responderAdmissao } from "@/lib/admissao/admissao-rotas";

/** O link morre agora (vazou, foi para a pessoa errada). O RH reenvia depois, com prazo novo. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ator, resposta } = await guardaDoRh();
  if (!ator) return resposta;
  return responderAdmissao(() => invalidarConvite(ator, id));
}
