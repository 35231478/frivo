import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ehDonoDoFrivo, MSG_SO_O_DONO_EMPRESAS } from "@/lib/anotacoes/dono";
import { alterarSituacaoEmpresa } from "@/lib/empresa/criar-empresa";

/** PATCH { ativo } — inativar ou reativar a empresa (só o dono do Frivo; a própria empresa dele não se inativa) */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });
  if (!ehDonoDoFrivo(session.user)) return NextResponse.json({ erro: MSG_SO_O_DONO_EMPRESAS }, { status: 403 });
  const corpo = await req.json().catch(() => null);
  if (typeof corpo?.ativo !== "boolean") return NextResponse.json({ erro: "Informe se a empresa fica ativa." }, { status: 400 });
  const { id } = await params;
  const r = await alterarSituacaoEmpresa({ id, ativo: corpo.ativo, empresaDoDono: session.user.empresaId as string });
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json(r);
}
