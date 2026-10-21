import { NextRequest, NextResponse } from "next/server";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { atorDaSessao } from "@/lib/execucao/contexto";
import { limparOperacoesAntigas, loteSchema, processarLote } from "@/lib/tecnico/sync";

/**
 * Recebe a fila de gravações do app do técnico (feitas com ou sem sinal) e aplica em ordem, cada uma
 * com as mesmas regras da tela da OS. Idempotente: reenviar uma operação já aplicada não grava de
 * novo. A resposta diz, operação por operação, o que subiu e o que ficou (com o motivo).
 */
export async function POST(req: NextRequest) {
  const guard = await exigirAlgumaPermissao([["ordens", "editar"], ["ordens", "concluir"]]);
  if (guard.erro) return guard.resposta;
  const parsed = loteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const ator = atorDaSessao(guard.session);
  const resultados = await processarLote(ator, parsed.data.operacoes);
  await limparOperacoesAntigas(ator).catch(() => undefined);
  return NextResponse.json({ resultados }, { headers: { "Cache-Control": "private, no-store" } });
}
