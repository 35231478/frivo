import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { ErroOcr } from "@/lib/ocr-ia";
import { lerCrlv } from "@/lib/veiculo-ocr";

// Duas tentativas de 20s no pior caso (SDK com maxRetries: 1)
export const maxDuration = 60;

/**
 * Lê a foto do documento do veículo (CRLV) com Claude (visão) e devolve só os dados do
 * VEÍCULO para CONFERÊNCIA na tela. Nada é salvo aqui e a foto não é guardada.
 * Body: { imagem: "data:image/jpeg;base64,..." }
 * Erros voltam como { erro, fallback: true }: a tela segue com digitação manual.
 * Só quem cadastra/edita veículos ("veiculos.gerenciar") usa.
 */
export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("veiculos", "gerenciar");
  if (guard.erro) return guard.resposta;

  const body = await req.json().catch(() => null);
  try {
    return NextResponse.json(await lerCrlv(body?.imagem));
  } catch (e) {
    const erro = e instanceof ErroOcr ? e : new ErroOcr("Falha inesperada na leitura.", 500);
    if (!(e instanceof ErroOcr)) console.error("OCR do CRLV falhou", e);
    return NextResponse.json({ erro: erro.message, fallback: true }, { status: erro.status });
  }
}
