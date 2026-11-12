import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { pode, type Permissoes } from "@/lib/permissoes";
import { ocorrenciaSchema } from "@/lib/pmoc-ocorrencias";
import { criarOcorrencia, ocorrenciasDoPlano, responder } from "@/lib/pmoc-ocorrencias-server";

type Params = { params: Promise<{ id: string }> };

/**
 * As ocorrências do plano (com as excluídas: a tela separa). Exige "PMOC › Visualizar".
 * As OS do cliente, que o formulário oferece para ligar, só vão para quem tem "PMOC › Editar".
 */
export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("pmoc", "visualizar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const user = guard.session.user!;
  const edita = pode(user.permissoes as Permissoes, "pmoc", "editar", user.role);
  const dados = await ocorrenciasDoPlano(id, user.empresaId, edita);
  if (!dados) return NextResponse.json({ erro: "PMOC não encontrado" }, { status: 404 });
  return NextResponse.json(dados);
}

/** Registra uma ocorrência no plano. Exige "PMOC › Editar". */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("pmoc", "editar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const parsed = ocorrenciaSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const user = guard.session.user!;
  return responder(() => criarOcorrencia(id, { empresaId: user.empresaId, usuarioId: user.id }, parsed.data), 201);
}
