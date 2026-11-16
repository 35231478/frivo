import { type NextRequest } from "next/server";
import { corpo, guardaDeDocumentos, responderDocumento } from "@/lib/documentos/documentos-rotas";
import { ErroDocumento, montarDocumento } from "@/lib/documentos/documentos-server";
import { ehSensivel, type ItemDocumento } from "@/lib/documentos/modelos";

type Params = { params: Promise<{ id: string }> };

/**
 * A prévia: o texto já preenchido, o que ficou faltando e os campos que o modelo usa e o sistema
 * não conhece. Não grava nada — é o que a tela mostra antes de gerar.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { ator, resposta } = await guardaDeDocumentos();
  if (!ator) return resposta;
  const { id } = await params;
  const b = await corpo(req);
  return responderDocumento(async () => {
    const pronto = await montarDocumento(id, ator.empresaId, {
      modeloId: String(b.modeloId ?? ""),
      valores: (b.valores ?? null) as Record<string, string> | null,
      itens: (b.itens ?? null) as Partial<ItemDocumento>[] | null,
    });
    if (ehSensivel(pronto.modelo.tipo) && !ator.podeDisciplinar) {
      throw new ErroDocumento("Sem permissão para esta ação", 403);
    }
    const { modelo, colaborador: _colaborador, ...resto } = pronto;
    return { ...resto, tipo: modelo.tipo, temItens: modelo.temItens, exigeAssinatura: modelo.exigeAssinatura };
  });
}
