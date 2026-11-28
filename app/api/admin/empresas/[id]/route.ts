import { NextRequest, NextResponse } from "next/server";
import { exigirDonoDoFrivo } from "@/lib/empresa/guarda-dono";
import { alterarSituacaoEmpresa, detalheDaEmpresa, editarEmpresa, editarEmpresaSchema } from "@/lib/empresa/criar-empresa";

/**
 * Uma empresa, na área do dono do Frivo (só SUPER_ADMIN; os outros recebem 403):
 *  GET   — os dados do cadastro (razão social, nome fantasia, CNPJ, e-mail, telefone) e a trilha recente;
 *  PUT   — editar esses dados (CNPJ válido e único), com o antes → depois na trilha;
 *  PATCH { ativo } — inativar ou reativar (a própria empresa do dono não se inativa).
 */
type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const g = await exigirDonoDoFrivo();
  if (g.erro) return g.erro;
  const d = await detalheDaEmpresa((await params).id);
  if (!d) return NextResponse.json({ erro: "Empresa não encontrada." }, { status: 404 });
  return NextResponse.json(d);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const g = await exigirDonoDoFrivo();
  if (g.erro) return g.erro;
  const parsed = editarEmpresaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const primeira = parsed.error.issues[0];
    return NextResponse.json({ erro: primeira?.message ?? "Dados inválidos.", campo: primeira?.path.join(".") ?? null }, { status: 400 });
  }
  const r = await editarEmpresa({ id: (await params).id, dados: parsed.data, autorId: g.session.user.id });
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json(r);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const g = await exigirDonoDoFrivo();
  if (g.erro) return g.erro;
  const corpo = await req.json().catch(() => null);
  if (typeof corpo?.ativo !== "boolean") return NextResponse.json({ erro: "Informe se a empresa fica ativa." }, { status: 400 });
  const { id } = await params;
  const r = await alterarSituacaoEmpresa({ id, ativo: corpo.ativo, empresaDoDono: g.session.user.empresaId as string, autorId: g.session.user.id });
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json(r);
}
