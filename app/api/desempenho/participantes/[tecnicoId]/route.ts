import { NextRequest } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { atorDa } from "@/lib/desempenho/api";
import { removerParticipante, responder } from "@/lib/desempenho/servidor";

/** Tira o colaborador do Desempenho (sai do ranking; o histórico de revisão dele fica). "Desempenho › Gerenciar". */
export async function DELETE(_: NextRequest, { params }: { params: Promise<{ tecnicoId: string }> }) {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { tecnicoId } = await params;
  return responder(() => removerParticipante(atorDa(guard.session), tecnicoId));
}
