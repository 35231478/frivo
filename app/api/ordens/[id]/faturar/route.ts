import { NextRequest } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { faturarOs } from "@/lib/faturamento/faturar-server";
import { lerCorpoFaturar, respostaFaturar } from "@/lib/faturamento/resposta";
import { sincronizarStatusOs } from "@/lib/os/sincronizar-status";
import { respostaPortaoPrestacao } from "@/lib/estoque/devolucao-server";

/**
 * "Faturar" a OS concluída (sem contrato): itens executados + adicionais "Cobrar" viram a fatura
 * (medição avulsa) já liberada para a NFS-e, e a conta a receber pelo líquido. Permissão:
 * Financeiro › Medições. Empresa da sessão. Já faturada → devolve a fatura existente (jaExistia).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("financeiro", "medicoes");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const empresaId = guard.session.user!.empresaId;
  const usuarioId = guard.session.user!.id;
  // E4.3 — Portões 2/3: com "Exigir prestação de contas de material" ligado, só fatura com o material 100% prestado contas
  const portao = await respostaPortaoPrestacao(empresaId, id, "faturar");
  if (portao) return portao;
  const corpo = await lerCorpoFaturar(req);
  if (!corpo.ok) return corpo.resposta;
  const { parcelamento, parcial } = corpo;
  const r = await faturarOs({ empresaId, usuarioId, osId: id, parcelamento, parcial });
  // Faturada, a OS passa a "Faturada" na central (status automático)
  if (r.tipo === "criada") await sincronizarStatusOs(id, empresaId, usuarioId).catch(() => null);
  return respostaFaturar(r, "OS");
}
