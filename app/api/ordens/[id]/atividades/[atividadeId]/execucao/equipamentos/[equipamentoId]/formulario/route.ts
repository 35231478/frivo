import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { TIPOS_IMAGEM } from "@/lib/anexos";
import { validarDataUrl } from "@/lib/anexos-server";
import { contextoExecucao, marcarAtendido } from "@/lib/execucao/contexto";

type Params = { params: Promise<{ id: string; atividadeId: string; equipamentoId: string }> };

const schema = z.object({
  formularioId: z.string().min(1),
  campoId: z.string().min(1),
  resposta: z.string().max(5000).nullable().optional(),
  arquivoUrl: z.string().nullable().optional(),
}).strict().refine((d) => d.resposta !== undefined || d.arquivoUrl !== undefined, "Nada para gravar.");

/**
 * Responde UM campo do formulário do tipo (tipo de OS × tipo de equipamento) para ESTE equipamento.
 * Antes o formulário era preenchido uma vez e replicado para todos do mesmo tipo — e reabrir gravava
 * vazio por cima. Agora: só o campo enviado muda, só neste equipamento.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const { id, atividadeId, equipamentoId } = await params;
  const ctx = await contextoExecucao(id, atividadeId, equipamentoId);
  if (!ctx.ok) return ctx.resposta;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const { formularioId, campoId, resposta } = parsed.data;
  const vinculo = ctx.vinculo!;

  // O formulário precisa ser o deste tipo de equipamento neste tipo de OS (ou já ter resposta aqui)
  const mapeado = ctx.atividade.tipoOsId && vinculo.equipamento.tipoEquipamentoId
    ? await prisma.formTypeMapping.findFirst({
      where: { empresaId: ctx.empresaId, tipoOsId: ctx.atividade.tipoOsId, tipoEquipamentoId: vinculo.equipamento.tipoEquipamentoId, formularioTemplateId: formularioId },
      select: { id: true },
    })
    : null;
  const campo = await prisma.formularioCampo.findFirst({ where: { id: campoId, formularioId, formulario: { empresaId: ctx.empresaId } }, select: { id: true, tipo: true, ativo: true } });
  const ja = await prisma.respostaFormularioEquipamento.findFirst({ where: { atividadeId, equipamentoId, campoId }, select: { id: true } });
  if (!campo || (!mapeado && !ja) || (!campo.ativo && !ja))
    return NextResponse.json({ erro: "Este campo não é do formulário deste equipamento." }, { status: 400 });

  let arquivoUrl = parsed.data.arquivoUrl;
  if (arquivoUrl && campo.tipo === "FOTO") {
    const v = validarDataUrl(arquivoUrl, "foto.jpg", { tipos: TIPOS_IMAGEM, tamanhoMax: 5 * 1024 * 1024, mensagemTipo: "Envie uma foto (JPG, PNG, WEBP ou HEIC)." });
    if (!v.ok) return NextResponse.json({ erro: v.erro }, { status: 400 });
    arquivoUrl = v.arquivo.conteudo;
  } else if (arquivoUrl && arquivoUrl.length > 300) {
    return NextResponse.json({ erro: "Valor inválido para este campo." }, { status: 400 });
  }

  const agora = new Date();
  const r = await prisma.respostaFormularioEquipamento.upsert({
    where: { atividadeId_equipamentoId_campoId: { atividadeId, equipamentoId, campoId } },
    create: {
      empresaId: ctx.empresaId, atividadeId, equipamentoId, formularioId, campoId,
      resposta: resposta ?? null, arquivoUrl: arquivoUrl ?? null, respondidoPorId: ctx.atividade.tecnicoId, respondidoEm: agora,
    },
    update: {
      ...(resposta !== undefined && { resposta }),
      ...(arquivoUrl !== undefined && { arquivoUrl }),
      respondidoPorId: ctx.atividade.tecnicoId, respondidoEm: agora,
    },
    select: { campoId: true, resposta: true, arquivoUrl: true },
  });
  if ((r.resposta ?? "").trim() || r.arquivoUrl) await marcarAtendido(vinculo);
  return NextResponse.json({ ...r, feito: vinculo.feito });
}
