import { NextRequest } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { atorDa, corpo, invalido } from "@/lib/desempenho/api";
import { decisaoSchema } from "@/lib/desempenho/regras";
import { decidirPenalidade } from "@/lib/desempenho/penalidades-server";
import { responder } from "@/lib/desempenho/servidor";
import { tecnicoDaSessao } from "@/lib/tecnico/sessao";

/**
 * A decisão da revisão: "conta" / "não conta" (com motivo) ou de volta para "a revisar". Ninguém
 * decide a própria penalidade. Exige "Desempenho › Revisar penalidades".
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("desempenho", "revisar");
  if (guard.erro) return guard.resposta;
  const parsed = decisaoSchema.safeParse(await corpo(req));
  if (!parsed.success) return invalido(parsed.error);
  const { id } = await params;
  const tecnico = await tecnicoDaSessao(guard.session);
  return responder(() => decidirPenalidade({ ...atorDa(guard.session), tecnicoId: tecnico?.id ?? null }, id, parsed.data));
}
