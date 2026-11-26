import { NextRequest, NextResponse } from "next/server";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { materialAvulso } from "@/lib/orcamentos/materiais";
import { materiaisPadraoDoServico, produtoComoMaterial } from "@/lib/orcamentos/materiais-server";
import { podeVerCusto } from "@/lib/orcamentos/estoque-margem-server";
import { semCustoNosMateriais } from "@/lib/orcamentos/estoque-margem";

/**
 * Estoque E3.3 — materializar no orçamento:
 *   GET ?servicoId=…&clienteId=…  → { materiais: [...] }  a composição do serviço (kit explodido), com quantidade
 *                                   padrão, valor de venda (tabela do cliente ou padrão) e custo interno;
 *   GET ?produtoId=…&clienteId=…  → { material: {...} }   um produto do catálogo como material AVULSO.
 * Tudo da empresa da sessão; quem monta orçamento (criar/editar) pode chamar.
 */
export async function GET(req: NextRequest) {
  const guard = await exigirAlgumaPermissao([["orcamentos", "criar"], ["orcamentos", "editar"]]);
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  // "Orçamentos › Ver custo e margem": sem ela, o custo interno não sai daqui (o salvar o recalcula no servidor)
  const verCusto = podeVerCusto(guard.session.user);
  const sp = req.nextUrl.searchParams;
  const clienteId = sp.get("clienteId") || null;
  const servicoId = sp.get("servicoId");
  const produtoId = sp.get("produtoId");
  if (servicoId) {
    const materiais = await materiaisPadraoDoServico(empresaId, servicoId, clienteId);
    if (!materiais) return NextResponse.json({ erro: "Serviço não encontrado" }, { status: 404 });
    return NextResponse.json({ materiais: verCusto ? materiais : semCustoNosMateriais(materiais) });
  }
  if (produtoId) {
    const r = await produtoComoMaterial(empresaId, produtoId, clienteId);
    if (!r) return NextResponse.json({ erro: "Produto não encontrado" }, { status: 404 });
    const { produto: p } = r;
    const material = materialAvulso({ produtoId: p.id, nome: p.nome, unidade: p.unidade, comportamento: p.categoriaProduto?.comportamento, valorVendaUnit: r.valorVendaUnit, custoUnit: r.custoUnit });
    return NextResponse.json({ material: verCusto ? material : semCustoNosMateriais([material])[0] });
  }
  return NextResponse.json({ erro: "Informe servicoId ou produtoId" }, { status: 400 });
}
