import { NextRequest } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { autorDa, corpo, invalido } from "@/lib/desempenho/api";
import { reabrirSchema } from "@/lib/desempenho/fechamento";
import { reabrirMes } from "@/lib/desempenho/fechamento-server";
import { responder } from "@/lib/desempenho/servidor";

/**
 * REABRE um mês fechado. Exige "Desempenho › Gerenciar" e um motivo; fica registrado quem reabriu,
 * quando e por quê (o fechamento anterior continua no histórico).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  const parsed = reabrirSchema.safeParse(await corpo(req));
  if (!parsed.success) return invalido(parsed.error);
  const { id } = await params;
  return responder(() => reabrirMes(autorDa(guard.session), id, parsed.data.motivo));
}
