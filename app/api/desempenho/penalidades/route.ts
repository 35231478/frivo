import { NextRequest } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { atorDa, corpo, invalido } from "@/lib/desempenho/api";
import { SITUACOES_PENALIDADE, ehCompetencia, reclamacaoSchema } from "@/lib/desempenho/regras";
import { listarPenalidades, registrarReclamacao } from "@/lib/desempenho/penalidades-server";
import { desempenhoAtivo, responder } from "@/lib/desempenho/servidor";

/**
 * A lista "a revisar" (retorno, ressalva do cliente, reclamação). Detecta o que falta antes de
 * listar. Filtros: `?situacao=` e `?mes=`. Exige "Desempenho › Revisar penalidades".
 */
export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("desempenho", "revisar");
  if (guard.erro) return guard.resposta;
  const p = req.nextUrl.searchParams;
  const situacao = (SITUACOES_PENALIDADE as readonly string[]).includes(p.get("situacao") ?? "") ? p.get("situacao") : null;
  const mes = p.get("mes");
  const empresaId = guard.session.user.empresaId;
  return responder(async () => ({ ativo: await desempenhoAtivo(empresaId), ...(await listarPenalidades(empresaId, { situacao, competencia: ehCompetencia(mes) ? mes : null })) }));
}

/** Registra uma reclamação recebida por fora do sistema. Nasce "a revisar". */
export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("desempenho", "revisar");
  if (guard.erro) return guard.resposta;
  const parsed = reclamacaoSchema.safeParse(await corpo(req));
  if (!parsed.success) return invalido(parsed.error);
  return responder(() => registrarReclamacao(atorDa(guard.session), parsed.data), 201);
}
