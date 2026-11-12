import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { dadosNovoOrcamento } from "@/lib/orcamentos/form-dados";

/**
 * Dados do construtor de orçamento para abrir FORA da página /orcamentos/novo — a gaveta
 * "Criar orçamento" da OS. Mesma permissão de criar orçamento; OS de outra empresa = 404.
 */
export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("orcamentos", "criar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { searchParams } = new URL(req.url);
  const osId = searchParams.get("osId");
  const dados = await dadosNovoOrcamento(empresaId, { clienteId: searchParams.get("clienteId"), osId });
  if (osId && !dados.osInicial) return NextResponse.json({ erro: "OS não encontrada." }, { status: 404 });
  return NextResponse.json(dados);
}
