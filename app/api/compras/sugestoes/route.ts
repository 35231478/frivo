import { NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { sugestoesDoEstoque } from "@/lib/compras/sugestao-compra-server";

/**
 * GET — o que o estoque sugere comprar: produtos no mínimo ou abaixo, com o último fornecedor e preço.
 * Mesma permissão do pedido avulso (Compras › Gerenciar), que é quem pode usar a sugestão.
 */
export async function GET() {
  const guard = await exigirPermissao("compras", "gerenciar");
  if (guard.erro) return guard.resposta;
  return NextResponse.json({ itens: await sugestoesDoEstoque(guard.session.user!.empresaId) });
}
