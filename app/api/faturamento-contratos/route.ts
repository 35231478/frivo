import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { anoBR, mesBR } from "@/lib/fuso";
import { painelFaturamentoContratos } from "@/lib/faturamento/painel-contratos-server";

/** Tela "Faturamento de contratos" (?ano=&mes=, padrão: mês corrente). Empresa sempre da sessão. */
export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("financeiro", "medicoes");
  if (guard.erro) return guard.resposta;
  const sp = req.nextUrl.searchParams;
  const mes = Number(sp.get("mes")) || mesBR();
  const ano = Number(sp.get("ano")) || anoBR();
  if (mes < 1 || mes > 12 || ano < 2000 || ano > 2100) return NextResponse.json({ erro: "Competência inválida" }, { status: 400 });
  return NextResponse.json(await painelFaturamentoContratos(guard.session.user!.empresaId, ano, mes));
}
