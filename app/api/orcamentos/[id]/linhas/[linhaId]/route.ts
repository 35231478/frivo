import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { linhaOrcamentoContextoSchema } from "@/lib/validations";
import { editarLinhaDoOrcamento } from "@/lib/orcamentos/editar-linha-server";

type Params = { params: Promise<{ id: string; linhaId: string }> };

/**
 * PATCH /api/orcamentos/[id]/linhas/[linhaId] — edição de UMA linha como USO ("Editando este item do
 * orçamento"): descrição, quantidade, preço aplicado neste orçamento e observação, e só o que mudou.
 * Nunca toca no catálogo. Só em rascunho (a regra de sempre); aprovado, faturado e com nota são registro
 * fechado. Mesma permissão da edição do orçamento.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("orcamentos", "editar");
  if (guard.erro) return guard.resposta;
  const { id, linhaId } = await params;
  const parsed = linhaOrcamentoContextoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const r = await editarLinhaDoOrcamento(guard.session.user!.empresaId, id, linhaId, parsed.data);
  return r.ok ? NextResponse.json({ linha: r.linha, totalGeral: r.totalGeral }) : NextResponse.json({ erro: r.erro }, { status: r.status });
}
