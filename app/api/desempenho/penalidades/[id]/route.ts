import { NextRequest } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { atorDa, corpo, invalido } from "@/lib/desempenho/api";
import { reclamacaoSchema } from "@/lib/desempenho/regras";
import { atualizarReclamacao, excluirReclamacao } from "@/lib/desempenho/penalidades-server";
import { responder } from "@/lib/desempenho/servidor";

type Params = { params: Promise<{ id: string }> };

/** Corrige a reclamação registrada à mão (volta para "a revisar"). "Desempenho › Revisar penalidades". */
export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("desempenho", "revisar");
  if (guard.erro) return guard.resposta;
  const parsed = reclamacaoSchema.safeParse(await corpo(req));
  if (!parsed.success) return invalido(parsed.error);
  const { id } = await params;
  return responder(() => atualizarReclamacao(atorDa(guard.session), id, parsed.data));
}

/** Exclui a reclamação registrada à mão (as detectadas não se excluem: decide-se "não conta"). */
export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("desempenho", "revisar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  return responder(() => excluirReclamacao(atorDa(guard.session), id));
}
