import { NextRequest, NextResponse } from "next/server";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { atorDaSessao, carregarContexto } from "@/lib/execucao/contexto";
import { carregarConfigApp } from "@/lib/tecnico/config-app-server";
import { MSG_CADASTRO_DESLIGADO } from "@/lib/tecnico/cadastro-equipamento";
import { ErroOcr } from "@/lib/ocr-ia";
import { lerEtiqueta } from "@/lib/equipamento-ocr";

// Duas tentativas de 20s no pior caso (SDK com maxRetries: 1) — o mesmo do cadastro pela foto do painel
export const maxDuration = 60;

type Params = { params: Promise<{ atividadeId: string }> };

/**
 * Cadastro em campo: lê a foto da ETIQUETA do equipamento (a mesma leitura do "Cadastro pela foto" do
 * painel) e devolve os campos para o técnico CONFERIR — nada é salvo aqui. Só com sinal; sem sinal o
 * app nem chama (o técnico digita). Quem pode: quem executa ESTA atividade (permissão da OS + escopo
 * do técnico), com "Permitir cadastrar equipamento em campo" ligado na empresa.
 * Erros voltam como { erro, fallback: true }: o app segue com digitação.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirAlgumaPermissao([["ordens", "editar"], ["ordens", "concluir"]]);
  if (guard.erro) return guard.resposta;
  const { atividadeId } = await params;
  const ctx = await carregarContexto(atorDaSessao(guard.session), atividadeId);
  if (!ctx.ok) return ctx.resposta;
  if (!(await carregarConfigApp(ctx.empresaId)).cadastrarEquipamento) return NextResponse.json({ erro: MSG_CADASTRO_DESLIGADO, fallback: true }, { status: 403 });

  const body = await req.json().catch(() => null);
  try {
    return NextResponse.json(await lerEtiqueta(body?.imagem), { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    const erro = e instanceof ErroOcr ? e : new ErroOcr("Falha inesperada na leitura.", 500);
    if (!(e instanceof ErroOcr)) console.error("OCR de etiqueta (app do técnico) falhou", e);
    return NextResponse.json({ erro: erro.message, fallback: true }, { status: erro.status });
  }
}
