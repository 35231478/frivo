import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { ocorrenciaSchema, situacaoSchema } from "@/lib/pmoc-ocorrencias";
import { atualizarOcorrencia, excluirOuRestaurar, mudarSituacao, responder } from "@/lib/pmoc-ocorrencias-server";

type Params = { params: Promise<{ id: string; ocorrenciaId: string }> };

/** Quem pede, depois de conferir "PMOC › Editar" (toda mudança na ocorrência exige isso) */
async function editor() {
  const guard = await exigirPermissao("pmoc", "editar");
  if (guard.erro) return { resposta: guard.resposta };
  return { ator: { empresaId: guard.session.user!.empresaId, usuarioId: guard.session.user!.id } };
}
const invalido = (mensagem: string | undefined) => NextResponse.json({ erro: mensagem ?? "Dados inválidos" }, { status: 400 });

/** Edita a ocorrência inteira (o formulário). */
export async function PUT(req: NextRequest, { params }: Params) {
  const { ator, resposta } = await editor();
  if (!ator) return resposta;
  const { id, ocorrenciaId } = await params;
  const parsed = ocorrenciaSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return invalido(parsed.error.issues[0]?.message);
  return responder(() => atualizarOcorrencia(id, ocorrenciaId, ator, parsed.data));
}

/** Ação rápida: `{ restaurar: true }` traz de volta a excluída; `{ situacao, … }` resolve, reabre ou põe em andamento. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { ator, resposta } = await editor();
  if (!ator) return resposta;
  const { id, ocorrenciaId } = await params;
  const corpo = await req.json().catch(() => ({}));
  if (corpo?.restaurar === true) return responder(() => excluirOuRestaurar(id, ocorrenciaId, ator, true));
  const parsed = situacaoSchema.safeParse(corpo);
  if (!parsed.success) return invalido(parsed.error.issues[0]?.message);
  return responder(() => mudarSituacao(id, ocorrenciaId, ator, parsed.data));
}

/** Exclui: a ocorrência sai da lista e do documento, mas fica guardada (dá para restaurar). */
export async function DELETE(_: NextRequest, { params }: Params) {
  const { ator, resposta } = await editor();
  if (!ator) return resposta;
  const { id, ocorrenciaId } = await params;
  return responder(() => excluirOuRestaurar(id, ocorrenciaId, ator, false));
}
