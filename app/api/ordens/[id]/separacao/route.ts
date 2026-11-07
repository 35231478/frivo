import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { respostaRefEmpresa } from "@/lib/ref-empresa";
import { ErroEstoque } from "@/lib/estoque/servidor";
import { mensagemSeparacao, separacaoSchema } from "@/lib/estoque/separacao";
import { ErroSeparacao, separacaoDaOs, separarMateriais } from "@/lib/estoque/separacao-server";

type Params = { params: Promise<{ id: string }> };

/** GET /api/ordens/[id]/separacao → os materiais da OS com o saldo disponível e o estado da separação. */
export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("estoque", "separar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const r = await separacaoDaOs(guard.session.user!.empresaId, id);
  if (!r) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
  return NextResponse.json(r);
}

/**
 * POST /api/ordens/[id]/separacao { materiais: [{ id, quantidade }] } — leva cada material ao alvo (quanto fica
 * separado no total; 0 = desfazer): RESERVA/estorno no razão + estado por material, numa transação. Saldo que não
 * cobre não trava (volta em `avisos`). Material de outra OS, alvo acima do necessário, material já consumido = 400.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("estoque", "separar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const parsed = separacaoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: mensagemSeparacao(parsed.error) }, { status: 400 });
  try {
    const r = await separarMateriais(session.user!.empresaId, id, session.user!.id, parsed.data.materiais);
    if (!r) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof ErroSeparacao || e instanceof ErroEstoque) return NextResponse.json({ erro: e.message }, { status: 400 });
    const r = respostaRefEmpresa(e);
    if (r) return r;
    throw e;
  }
}
