import { NextRequest, NextResponse } from "next/server";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { atorDaSessao } from "@/lib/execucao/contexto";
import { limparOperacoesAntigas, loteSchema, processarLote } from "@/lib/tecnico/sync";
import { ipDaRequisicao } from "@/lib/orcamentos/ciclo";
import { pode, type Permissoes } from "@/lib/permissoes";

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
  const { permissoes, role } = guard.session.user;
  const resultados = await processarLote(ator, parsed.data.operacoes, {
    agoraAparelho: parsed.data.agora, ip: ipDaRequisicao(req.headers), userAgent: req.headers.get("user-agent"),
    // Colher o aceite do cliente é de quem EDITA a OS (quem só conclui não colhe)
    podeEditarOs: pode(permissoes as Permissoes, "ordens", "editar", role),
  });
  await limparOperacoesAntigas(ator).catch(() => undefined);
  return NextResponse.json({ resultados }, { headers: { "Cache-Control": "private, no-store" } });
}
