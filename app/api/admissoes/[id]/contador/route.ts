import { marcarEnviadoContador } from "@/lib/admissao/admissao-server";
import { guardaDoRh, responderAdmissao } from "@/lib/admissao/admissao-rotas";

/** A ficha e os documentos foram baixados para o contador. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ator, resposta } = await guardaDoRh();
  if (!ator) return resposta;
  return responderAdmissao(() => marcarEnviadoContador(ator, id));
}
