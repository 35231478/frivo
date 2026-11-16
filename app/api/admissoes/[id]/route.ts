import { progressoDaAdmissao } from "@/lib/admissao/admissao-server";
import { guardaDoRh, responderAdmissao } from "@/lib/admissao/admissao-rotas";

/** O progresso de uma admissão: onde parou, o que falta e os documentos que chegaram. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ator, resposta } = await guardaDoRh();
  if (!ator) return resposta;
  return responderAdmissao(() => progressoDaAdmissao(ator.empresaId, id));
}
