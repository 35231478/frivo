import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { osDaEmpresa } from "@/lib/os-server";
import { atorDaSessao, carregarContexto } from "@/lib/execucao/contexto";
import { removerFoto, removerFotoAdicional } from "@/lib/execucao/acoes";
import { nomeEquipamento } from "@/lib/execucao/vinculos";
import { legendaAdicional, legendaExecucao } from "@/lib/os/galeria";

type Params = { params: Promise<{ id: string; fotoId: string }> };

/**
 * Exclui, pela galeria da OS, uma foto da EXECUÇÃO (`?origem=EXECUCAO`) ou de um SERVIÇO ADICIONAL
 * (`?origem=ADICIONAL`) — as fotos enviadas como anexo saem pela rota do anexo. Exige editar a OS e
 * a atividade ABERTA (as mesmas regras da execução: concluída, reabra antes). Fica no histórico quem
 * excluiu.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const { id, fotoId } = await params;
  if (!(await osDaEmpresa(id, empresaId))) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
  const origem = req.nextUrl.searchParams.get("origem");

  let alvo: { atividadeId: string; detalhes: string } | null = null;
  if (origem === "EXECUCAO") {
    const f = await prisma.fotoAtendimento.findFirst({
      where: { id: fotoId, empresaId, atividade: { ordemServicoId: id } },
      select: { atividadeId: true, momento: true, item: { select: { texto: true } }, equipamento: { select: { nome: true, marca: true, modelo: true } } },
    });
    if (f) alvo = { atividadeId: f.atividadeId, detalhes: `${legendaExecucao({ momento: f.momento, item: f.item?.texto ?? null })} — ${nomeEquipamento(f.equipamento)}` };
  } else if (origem === "ADICIONAL") {
    const f = await prisma.servicoAdicionalFoto.findFirst({
      where: { id: fotoId, empresaId, servico: { ordemServicoId: id } },
      select: { servico: { select: { atividadeId: true, descricao: true } } },
    });
    if (f) alvo = { atividadeId: f.servico.atividadeId, detalhes: legendaAdicional(f.servico.descricao) };
  } else {
    return NextResponse.json({ erro: "Diga de onde é a foto (execução ou serviço adicional)." }, { status: 400 });
  }
  if (!alvo) return NextResponse.json({ erro: "Foto não encontrada" }, { status: 404 });

  // Mesmas regras da execução: atividade aberta (e, no modo técnico, só as dele)
  const ctx = await carregarContexto(atorDaSessao(session), alvo.atividadeId, { osId: id });
  if (!ctx.ok) return NextResponse.json({ erro: ctx.erro }, { status: ctx.status });
  const r = origem === "EXECUCAO" ? await removerFoto(ctx, { fotoId }) : await removerFotoAdicional(ctx, { fotoId });
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });

  await prisma.osHistorico.create({
    data: { ordemServicoId: id, usuarioId: session.user!.id, acao: origem === "EXECUCAO" ? "Foto da execução excluída" : "Foto de serviço adicional excluída", detalhes: alvo.detalhes },
  });
  return NextResponse.json({ ok: true });
}
