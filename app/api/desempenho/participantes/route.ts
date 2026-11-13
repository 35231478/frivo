import { NextRequest } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { atorDa, corpo, invalido } from "@/lib/desempenho/api";
import { participanteSchema } from "@/lib/desempenho/regras";
import { definirParticipante, responder } from "@/lib/desempenho/servidor";

/** Põe o colaborador num perfil (ou muda de perfil). "Desempenho › Gerenciar". */
export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  const parsed = participanteSchema.safeParse(await corpo(req));
  if (!parsed.success) return invalido(parsed.error);
  return responder(() => definirParticipante(atorDa(guard.session), parsed.data));
}
