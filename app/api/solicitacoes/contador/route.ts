import { NextResponse } from "next/server";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { SOLICITACAO_PENDENTE } from "@/lib/solicitacoes";

/**
 * O CONTADOR das solicitações pendentes — o mínimo para o Calendário saber que chegou chamado novo
 * sem pagar a lista inteira a cada minuto: quantas há e o `criadoEm` da mais recente. Um count e um
 * max no índice que já existe; nada de descrição, joins ou fotos (isso é /api/solicitacoes, que só
 * roda quando a gaveta abre). Mesma permissão da gaveta.
 */
export async function GET() {
  const guard = await exigirAlgumaPermissao([["ordens", "editar"], ["ordens", "excluir"]]);
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;

  const where = { empresaId, ...SOLICITACAO_PENDENTE };
  const [total, ultima] = await Promise.all([
    prisma.ordemServico.count({ where }),
    prisma.ordemServico.findFirst({ where, orderBy: { criadoEm: "desc" }, select: { criadoEm: true } }),
  ]);

  return NextResponse.json(
    { total, maisRecenteEm: ultima?.criadoEm ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
