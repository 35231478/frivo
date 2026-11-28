import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { osDaEmpresa } from "@/lib/os-server";
import { atorDaSessao, carregarContexto } from "@/lib/execucao/contexto";
import { removerFoto, removerFotoAdicional } from "@/lib/execucao/acoes";
import { nomeEquipamento } from "@/lib/execucao/vinculos";
import { legendaAdicional, legendaExecucao } from "@/lib/os/galeria";
import { editarLegendaFoto, restaurarLegendaFoto } from "@/lib/os/legenda-foto-server";
import { escopoBarra } from "@/lib/escopo/proprios-server";

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
  const foraDoEscopo = await escopoBarra("ordem", id); // COM-1: "Ver só os próprios" → 404
  if (foraDoEscopo) return foraDoEscopo;
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

const ORIGENS = ["EXECUCAO", "ADICIONAL", "ANEXO"] as const;

/**
 * EDITA A LEGENDA da foto, de qualquer origem da galeria (`?origem=EXECUCAO|ADICIONAL|ANEXO`). Exige
 * editar a OS; no modo técnico, só a foto de uma atividade dele e com a OS ainda aberta (a regra é a
 * mesma do app: lib/os/galeria › motivoSemEditarLegenda). Fica no histórico a legenda de antes e a nova.
 * Com `{ restaurar: true }`: volta à legenda do sistema (as mesmas permissões e a mesma trilha).
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("ordens", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id, fotoId } = await params;
  const foraDoEscopo = await escopoBarra("ordem", id); // COM-1: "Ver só os próprios" → 404
  if (foraDoEscopo) return foraDoEscopo;
  const origem = req.nextUrl.searchParams.get("origem") as (typeof ORIGENS)[number] | null;
  if (!origem || !ORIGENS.includes(origem)) return NextResponse.json({ erro: "Diga de onde é a foto (execução, serviço adicional ou anexo)." }, { status: 400 });
  const corpo = await req.json().catch(() => null);
  const ator = { ...atorDaSessao(session), podeEditarOs: true };
  const r = corpo?.restaurar === true
    ? await restaurarLegendaFoto(ator, id, { origem, fotoId })
    : await editarLegendaFoto(ator, id, { origem, fotoId, legenda: corpo?.legenda });
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json({ legenda: r.dados.legenda });
}
