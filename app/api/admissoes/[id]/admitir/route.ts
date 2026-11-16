import { marcarAdmitido } from "@/lib/admissao/admissao-server";
import { guardaDoRh, responderAdmissao } from "@/lib/admissao/admissao-rotas";

/** Admissão concluída: o colaborador entra no quadro (ATIVO) e a admissão fecha. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ator, resposta } = await guardaDoRh();
  if (!ator) return resposta;
  return responderAdmissao(() => marcarAdmitido(ator, id));
}
