import { NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { revisoesDaEmpresa } from "@/lib/comissoes/executor-server";

/**
 * COM-2 — "Estornos a revisar": retorno no mesmo equipamento dentro dos dias da configuração. As abertas primeiro,
 * depois as últimas decididas. "Desempenho › Gerenciar" (quem fecha o mês).
 */
export async function GET() {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  return NextResponse.json({ revisoes: await revisoesDaEmpresa(guard.session.user!.empresaId) });
}
