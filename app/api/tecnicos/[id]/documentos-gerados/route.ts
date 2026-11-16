import { type NextRequest } from "next/server";
import { corpo, guardaDeDocumentos, responderDocumento } from "@/lib/documentos/documentos-rotas";
import { documentosDoColaborador, gerarDocumento } from "@/lib/documentos/documentos-server";
import type { ItemDocumento } from "@/lib/documentos/modelos";

type Params = { params: Promise<{ id: string }> };

/**
 * O histórico de documentos gerados para este colaborador: o que, quando, por quem, e assinado ou
 * não. Advertência e suspensão só aparecem para quem tem a permissão própria.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { ator, resposta } = await guardaDeDocumentos();
  if (!ator) return resposta;
  const { id } = await params;
  return responderDocumento(() => documentosDoColaborador(id, ator.empresaId, ator.podeDisciplinar));
}

/** Gera o documento a partir de um modelo. O arquivo só entra na ficha quando está pronto. */
export async function POST(req: NextRequest, { params }: Params) {
  const { ator, resposta } = await guardaDeDocumentos();
  if (!ator) return resposta;
  const { id } = await params;
  const b = await corpo(req);
  return responderDocumento(
    () => gerarDocumento(
      id, ator.empresaId,
      {
        modeloId: String(b.modeloId ?? ""),
        valores: (b.valores ?? null) as Record<string, string> | null,
        itens: (b.itens ?? null) as Partial<ItemDocumento>[] | null,
      },
      { usuarioId: ator.usuarioId, podeDisciplinar: ator.podeDisciplinar },
    ),
    201,
  );
}
