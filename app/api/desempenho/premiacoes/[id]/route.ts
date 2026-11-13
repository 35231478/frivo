import { NextRequest } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { atorDa, corpo, invalido } from "@/lib/desempenho/api";
import { premiacaoSchema } from "@/lib/desempenho/regras";
import { atualizarPremiacao, excluirPremiacao } from "@/lib/desempenho/premiacoes-server";
import { responder } from "@/lib/desempenho/servidor";

type Params = { params: Promise<{ id: string }> };

/** Edita a premiação (sem `imagem` no corpo, a imagem fica como está; `null` tira). "Desempenho › Gerenciar". */
export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  const parsed = premiacaoSchema.safeParse(await corpo(req));
  if (!parsed.success) return invalido(parsed.error);
  const { id } = await params;
  return responder(() => atualizarPremiacao(atorDa(guard.session), id, parsed.data));
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  return responder(() => excluirPremiacao(atorDa(guard.session), id));
}
