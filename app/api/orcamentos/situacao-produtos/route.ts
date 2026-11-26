import { NextRequest, NextResponse } from "next/server";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { podeVerCusto, situacaoDosProdutos } from "@/lib/orcamentos/estoque-margem-server";

/**
 * GET /api/orcamentos/situacao-produtos?ids=a,b,c → { estoque, verCusto, produtos: { [id]: { unidade, disponivel?, custo? } } }
 * Para o Editar orçamento: o disponível em estoque (só com o módulo Estoque ligado — desligado, não vem e a tela
 * não mostra; nunca 403) e o último custo de compra (só com "Orçamentos › Ver custo e margem" — sem ela, o campo
 * não vem). Só produtos da empresa da sessão. Quem monta orçamento (criar/editar) pode chamar.
 */
export async function GET(req: NextRequest) {
  const guard = await exigirAlgumaPermissao([["orcamentos", "criar"], ["orcamentos", "editar"]]);
  if (guard.erro) return guard.resposta;
  const user = guard.session.user!;
  const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const verCusto = podeVerCusto(user);
  const r = await situacaoDosProdutos(user.empresaId, ids, { verCusto });
  return NextResponse.json({ ...r, verCusto });
}
