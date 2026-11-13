import { NextRequest } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { atorDa, corpo, invalido } from "@/lib/desempenho/api";
import { ehCompetencia, premiacaoSchema } from "@/lib/desempenho/regras";
import { criarPremiacao, listarPremiacoes } from "@/lib/desempenho/premiacoes-server";
import { responder } from "@/lib/desempenho/servidor";

/** As premiações (de um mês com `?mes=`, ou todas). "Desempenho › Visualizar". */
export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("desempenho", "visualizar");
  if (guard.erro) return guard.resposta;
  const mes = req.nextUrl.searchParams.get("mes");
  return responder(() => listarPremiacoes(guard.session.user.empresaId, ehCompetencia(mes) ? mes : null));
}

/** Cadastra a premiação do mês (texto + imagem do brinde). "Desempenho › Gerenciar". */
export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  const parsed = premiacaoSchema.safeParse(await corpo(req));
  if (!parsed.success) return invalido(parsed.error);
  return responder(() => criarPremiacao(atorDa(guard.session), parsed.data), 201);
}
