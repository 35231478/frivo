import { NextRequest } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { mesPedido } from "@/lib/desempenho/api";
import { responder } from "@/lib/desempenho/servidor";
import { VISTAS, type Vista } from "@/lib/comissoes/regras";
import { relatorioDeComissoes } from "@/lib/comissoes/servidor";

/**
 * COM-1 — as comissões do mês (`?mes=`) vistas por data de emissão ou por data de recebimento (`?vista=`).
 * Sem `vista`, a do "quando é devida" da empresa. Valores de pagamento: "Desempenho › Gerenciar", como o fechamento.
 */
export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  const pedida = req.nextUrl.searchParams.get("vista");
  const vista = (VISTAS as readonly string[]).includes(pedida ?? "") ? (pedida as Vista) : undefined;
  return responder(() => relatorioDeComissoes(guard.session.user.empresaId, mesPedido(req), vista));
}
