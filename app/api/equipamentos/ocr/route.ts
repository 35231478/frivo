import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { ErroOcr, lerEtiqueta, lerPlaca } from "@/lib/equipamento-ocr";

// Duas tentativas de 20s no pior caso (SDK com maxRetries: 1)
export const maxDuration = 60;

/**
 * Lê a foto da etiqueta do equipamento ("etiqueta") ou da placa da porta ("placa")
 * com Claude (visão) e devolve os campos para CONFERÊNCIA na tela — nada é salvo aqui.
 * Body: { tipo: "etiqueta" | "placa", imagem: "data:image/jpeg;base64,..." }
 * Erros voltam como { erro, fallback: true }: a tela segue com digitação manual.
 */
export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("equipamentos", "criar");
  if (guard.erro) return guard.resposta;

  const body = await req.json().catch(() => null);
  const tipo = body?.tipo;
  if (tipo !== "etiqueta" && tipo !== "placa")
    return NextResponse.json({ erro: "Tipo de leitura inválido.", fallback: true }, { status: 400 });

  try {
    const leitura = tipo === "etiqueta" ? await lerEtiqueta(body.imagem) : await lerPlaca(body.imagem);
    return NextResponse.json(leitura);
  } catch (e) {
    const erro = e instanceof ErroOcr ? e : new ErroOcr("Falha inesperada na leitura.", 500);
    if (!(e instanceof ErroOcr)) console.error("OCR de equipamento falhou", e);
    return NextResponse.json({ erro: erro.message, fallback: true }, { status: erro.status });
  }
}
