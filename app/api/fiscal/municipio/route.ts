import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { buscarMunicipio } from "@/lib/nfse/municipio";

/**
 * GET /api/fiscal/municipio — sugere o código IBGE do município pelo endereço da empresa da sessão
 * (CEP; se não der, UF + cidade). Financeiro › Fiscal. Só sugere: a tela deixa ajustar.
 */
export async function GET(_req: NextRequest) {
  const guard = await exigirPermissao("financeiro", "fiscal");
  if (guard.erro) return guard.resposta;
  const e = await prisma.empresa.findUnique({ where: { id: guard.session.user!.empresaId }, select: { cep: true, cidade: true, estado: true } });
  const m = await buscarMunicipio({ cep: e?.cep, cidade: e?.cidade, uf: e?.estado });
  if (!m) return NextResponse.json({ erro: "Não achei o código IBGE pelo endereço da empresa. Confira CEP, cidade e UF em Dados da empresa, ou digite o código." }, { status: 404 });
  return NextResponse.json(m);
}
