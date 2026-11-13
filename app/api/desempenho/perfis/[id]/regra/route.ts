import { NextRequest } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { atorDa, corpo, invalido } from "@/lib/desempenho/api";
import { regraSchema } from "@/lib/desempenho/regras";
import { descartarRegraAgendada, responder, salvarRegra } from "@/lib/desempenho/servidor";

type Params = { params: Promise<{ id: string }> };

/**
 * Salva a regra do perfil (pesos, meta mínima, faixas com valores, penalidades). A primeira vale já
 * no mês corrente; mudança depois só vale no mês seguinte. "Desempenho › Gerenciar".
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  const parsed = regraSchema.safeParse(await corpo(req));
  if (!parsed.success) return invalido(parsed.error);
  const { id } = await params;
  return responder(() => salvarRegra(atorDa(guard.session), id, parsed.data));
}

/** Descarta a mudança agendada para o mês seguinte (a regra em vigor continua). */
export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  return responder(() => descartarRegraAgendada(atorDa(guard.session), id));
}
