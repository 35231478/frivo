import { NextRequest } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { atorDa, corpo, invalido } from "@/lib/desempenho/api";
import { perfilSchema } from "@/lib/desempenho/regras";
import { criarPerfil, responder } from "@/lib/desempenho/servidor";

/** Cria um perfil de desempenho. "Desempenho › Gerenciar". */
export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  const parsed = perfilSchema.safeParse(await corpo(req));
  if (!parsed.success) return invalido(parsed.error);
  return responder(() => criarPerfil(atorDa(guard.session), parsed.data), 201);
}
