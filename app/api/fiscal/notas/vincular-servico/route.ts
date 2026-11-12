import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirPermissao } from "@/lib/permissoes-server";
import { ErroEmissao, vincularServicoItem } from "@/lib/nfse/emissao-server";

/**
 * Na tela "Emitir NFS-e": liga o item da medição sem serviço do catálogo ao serviço escolhido
 * (de onde vêm LC 116, código municipal e ISS). Financeiro › Fiscal; empresa da sessão.
 */
const schema = z.object({ medicaoId: z.string().min(1).max(40), itemId: z.string().min(1).max(40), servicoId: z.string().min(1).max(40) }).strict();

export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("financeiro", "fiscal");
  if (guard.erro) return guard.resposta;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Requisição inválida" }, { status: 400 });
  const { medicaoId, itemId, servicoId } = parsed.data;
  try {
    await vincularServicoItem(guard.session.user!.empresaId, medicaoId, itemId, servicoId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ErroEmissao) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
