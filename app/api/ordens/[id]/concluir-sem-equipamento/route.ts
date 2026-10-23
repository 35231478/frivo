import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { atorDaSessao, carregarContexto } from "@/lib/execucao/contexto";
import { concluirAtividade, respostaAcao } from "@/lib/execucao/acoes";
import { sincronizarStatusOs } from "@/lib/os/sincronizar-status";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  motivo: z.string().trim().min(10, "Explique o motivo (pelo menos 10 caracteres).").max(500, "Motivo com no máximo 500 caracteres."),
  /** Atividade a concluir junto (a que travou); sem ela, só autoriza — a OS segue o status automático */
  atividadeId: z.string().min(1).optional(),
}).strict();

/**
 * Exceção da trava de equipamento: conclui a OS (e a atividade que travou) SEM equipamento atendido,
 * com o motivo gravado na OS e no histórico (quem/quando). Só quem pode CONCLUIR OS. Equipamentos que
 * foram atendidos continuam exigindo o checklist completo — a exceção é só para "nenhum atendido".
 */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "concluir");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;
  const usuarioId = session.user!.id;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const { motivo, atividadeId } = parsed.data;

  const os = await prisma.ordemServico.findFirst({ where: { id, empresaId }, select: { id: true, status: true, semEquipamentoMotivo: true } });
  if (!os) return NextResponse.json({ erro: "Ordem de serviço não encontrada" }, { status: 404 });
  if (os.status === "CANCELADA") return NextResponse.json({ erro: "OS inativada: reabra antes de concluir." }, { status: 409 });

  // No modo técnico a justificativa é sempre por uma atividade DELE (sem ela, autorizaria qualquer OS)
  const ator = atorDaSessao(session);
  if (ator.escopo.restrito && !atividadeId) return NextResponse.json({ erro: "Justifique pela atividade que você está executando." }, { status: 403 });

  // A atividade (se veio) precisa ser desta OS e estar aberta — confere antes de gravar o motivo
  const ctx = atividadeId ? await carregarContexto(ator, atividadeId, { osId: id }) : null;
  if (ctx && !ctx.ok) return ctx.resposta;

  await prisma.ordemServico.update({ where: { id }, data: { semEquipamentoMotivo: motivo } });
  const registro = await prisma.osHistorico.create({
    data: { ordemServicoId: id, usuarioId, acao: "Conclusão sem equipamento autorizada", detalhes: motivo },
  });
  if (ctx) {
    const r = await concluirAtividade(ctx, {});
    if (!r.ok) {
      // Travou por outro motivo (equipamento atendido incompleto): desfaz a autorização
      await prisma.ordemServico.update({ where: { id }, data: { semEquipamentoMotivo: os.semEquipamentoMotivo } });
      await prisma.osHistorico.delete({ where: { id: registro.id } });
      return respostaAcao(r);
    }
  }
  const status = await sincronizarStatusOs(id, empresaId, usuarioId);
  return NextResponse.json({ ok: true, status, semEquipamentoMotivo: motivo });
}
