import { NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { conferirSaldos } from "@/lib/estoque/servidor";

/**
 * GET /api/estoque/conferencia → { divergentes: [{ produtoId, nome, saldoCache, somaRazao }] }
 * Só leitura: os produtos da empresa cujo saldo em cache não bate com a soma do razão (deve vir vazio).
 */
export async function GET() {
  const guard = await exigirPermissao("estoque", "visualizar");
  if (guard.erro) return guard.resposta;
  const divergentes = await conferirSaldos(guard.session.user!.empresaId);
  return NextResponse.json({ divergentes, total: divergentes.length });
}
