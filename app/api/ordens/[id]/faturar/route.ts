import { NextRequest } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { faturarOs } from "@/lib/faturamento/faturar-server";
import { respostaFaturar } from "@/lib/faturamento/resposta";
import { sincronizarStatusOs } from "@/lib/os/sincronizar-status";

/**
 * "Faturar" a OS concluída (sem contrato): itens executados + adicionais "Cobrar" viram a fatura
 * (medição avulsa) já liberada para a NFS-e, e a conta a receber pelo líquido. Permissão:
 * Financeiro › Medições. Empresa da sessão. Já faturada → devolve a fatura existente (jaExistia).
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("financeiro", "medicoes");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const empresaId = guard.session.user!.empresaId;
  const usuarioId = guard.session.user!.id;
  const r = await faturarOs({ empresaId, usuarioId, osId: id });
  // Faturada, a OS passa a "Faturada" na central (status automático)
  if (r.tipo === "criada") await sincronizarStatusOs(id, empresaId, usuarioId).catch(() => null);
  return respostaFaturar(r, "OS");
}
