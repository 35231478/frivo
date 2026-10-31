import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { previaCobrancaContrato } from "@/lib/financeiro/retencoes-server";

/**
 * Prévia da mensalidade do contrato com o serviço padrão: bruto − retenções = cobrado, e o que falta
 * no serviço para a NFS-e. GET ?servicoId=&valor=. A empresa vem da sessão.
 */
export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("contratos", "visualizar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const sp = req.nextUrl.searchParams;
  const servicoId = sp.get("servicoId")?.trim();
  if (!servicoId) return NextResponse.json({ erro: "Escolha o serviço." }, { status: 400 });
  const valor = Number(sp.get("valor") ?? 0);
  const previa = await previaCobrancaContrato(empresaId, servicoId, Number.isFinite(valor) ? valor : 0);
  if (!previa) return NextResponse.json({ erro: "Serviço não encontrado." }, { status: 404 });
  return NextResponse.json(previa);
}
