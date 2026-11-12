import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { TEXTO_SEM_GERAR } from "@/lib/pmoc-cronograma";
import { executarCronograma, lerCronograma } from "@/lib/pmoc-cronograma-server";
import { atorDoCronograma, planoEditavel } from "@/lib/pmoc-cronograma-rotas";

/**
 * "Reagendar atividades": deixa a agenda igual ao cronograma — cria as OS que faltam, muda a data das
 * que ainda não começaram, tira o equipamento que saiu do cronograma e cancela a OS que ficar vazia
 * (cancelar exige também "Ordens de serviço › Excluir"). Rodar de novo não duplica nada.
 */
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await exigirPermissao("pmoc", "editar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;
  const { erro } = await planoEditavel(id, empresaId);
  if (erro) return erro;
  const resultado = await executarCronograma(id, atorDoCronograma(guard.session), "reagendar");
  if (!resultado) return NextResponse.json({ erro: "PMOC não encontrado" }, { status: 404 });
  if (resultado.motivo) return NextResponse.json({ erro: TEXTO_SEM_GERAR[resultado.motivo] }, { status: 409 });
  return NextResponse.json({ resultado, cronograma: await lerCronograma(id, empresaId) });
}
