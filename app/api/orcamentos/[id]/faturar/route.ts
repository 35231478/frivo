import { NextRequest } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { faturarOrcamento } from "@/lib/faturamento/faturar-server";
import { lerParcelamento, respostaFaturar } from "@/lib/faturamento/resposta";

/**
 * "Faturar" o orçamento aprovado (com ou sem OS): cria a fatura (medição avulsa) já liberada para
 * a NFS-e e a conta a receber pelo líquido. Permissão: Financeiro › Medições. Empresa da sessão.
 * Já faturado (direto ou pela OS gerada dele) → devolve a fatura existente (jaExistia).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("financeiro", "medicoes");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const r = await faturarOrcamento({ empresaId: guard.session.user!.empresaId, usuarioId: guard.session.user!.id, orcamentoId: id, parcelamento: await lerParcelamento(req) });
  return respostaFaturar(r, "Orçamento");
}
