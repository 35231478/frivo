import { NextRequest } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { atorDa, corpo, invalido } from "@/lib/desempenho/api";
import { perfilSchema } from "@/lib/desempenho/regras";
import { atualizarPerfil, excluirPerfil, responder } from "@/lib/desempenho/servidor";

type Params = { params: Promise<{ id: string }> };

/** Renomeia o perfil (o tipo só muda enquanto ele não tem regra). "Desempenho › Gerenciar". */
export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  const parsed = perfilSchema.safeParse(await corpo(req));
  if (!parsed.success) return invalido(parsed.error);
  const { id } = await params;
  return responder(() => atualizarPerfil(atorDa(guard.session), id, parsed.data));
}

/** Exclui o perfil (só sem colaboradores nele). */
export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  return responder(() => excluirPerfil(atorDa(guard.session), id));
}
